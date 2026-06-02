import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { readdir, stat } from 'fs/promises';
import path from 'path';

const isDev = !app.isPackaged;

type ChatMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

type SendMessageParams = {
  sessionId: string;
  content: string;
  history: ChatMessageInput[];
};

type SessionRow = {
  id: string;
  title: string;
  workspace_path: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

let aiConfig: Partial<AiConfig> = {
  baseUrl: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
  model: process.env.AI_MODEL,
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30000)
};

let db: Database.Database;

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    title: row.title,
    workspacePath: row.workspace_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row: MessageRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initDatabase() {
  db = new Database(path.join(app.getPath('userData'), 'ai-workstation.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
}

function getRequiredConfig<K extends keyof AiConfig>(key: K, label: string) {
  const value = aiConfig[key];

  if (!value) {
    throw new Error(`${label} 未配置`);
  }

  return value;
}

ipcMain.handle('config:getAiConfig', async () => ({
  baseUrl: aiConfig.baseUrl ?? '',
  model: aiConfig.model ?? '',
  timeoutMs: aiConfig.timeoutMs ?? 30000,
  hasApiKey: Boolean(aiConfig.apiKey)
}));

ipcMain.handle('config:setAiConfig', async (_event, config: AiConfig) => {
  aiConfig = {
    baseUrl: config.baseUrl.trim(),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    timeoutMs: config.timeoutMs || 30000
  };

  return { ok: true };
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return {
      canceled: true,
      path: null
    };
  }

  return {
    canceled: false,
    path: result.filePaths[0]
  };
});

ipcMain.handle('session:create', async (_event, params: { workspacePath: string | null }) => {
  const now = new Date().toISOString();
  const session = {
    id: createId('session'),
    title: '新会话',
    workspace_path: params.workspacePath,
    created_at: now,
    updated_at: now
  };

  db.prepare(`
    INSERT INTO sessions (id, title, workspace_path, created_at, updated_at)
    VALUES (@id, @title, @workspace_path, @created_at, @updated_at)
  `).run(session);

  return mapSession(session);
});

ipcMain.handle('session:list', async () => {
  const rows = db.prepare(`
    SELECT id, title, workspace_path, created_at, updated_at
    FROM sessions
    ORDER BY updated_at DESC
  `).all() as SessionRow[];

  return rows.map(mapSession);
});

ipcMain.handle('session:get', async (_event, params: { sessionId: string }) => {
  const session = db.prepare(`
    SELECT id, title, workspace_path, created_at, updated_at
    FROM sessions
    WHERE id = ?
  `).get(params.sessionId) as SessionRow | undefined;

  if (!session) {
    throw new Error('会话不存在');
  }

  const messages = db.prepare(`
    SELECT id, session_id, role, content, created_at
    FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(params.sessionId) as MessageRow[];

  return {
    session: mapSession(session),
    messages: messages.map(mapMessage)
  };
});

ipcMain.handle('fileTree:list', async (_event, directoryPath: string) => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nodes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      const entryType = entry.isDirectory() ? 'directory' : 'file';

      try {
        const entryStat = await stat(entryPath);

        return {
          id: entryPath,
          name: entry.name,
          path: entryPath,
          type: entryType,
          size: entry.isFile() ? entryStat.size : null,
          modifiedAt: entryStat.mtime.toISOString()
        };
      } catch {
        return {
          id: entryPath,
          name: entry.name,
          path: entryPath,
          type: entryType,
          size: null,
          modifiedAt: null
        };
      }
    })
  );

  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, 'zh-CN');
  });
});

ipcMain.handle('chat:sendMessage', async (_event, params: SendMessageParams) => {
  const baseUrl = String(getRequiredConfig('baseUrl', 'AI Base URL')).replace(/\/$/, '');
  const apiKey = String(getRequiredConfig('apiKey', 'AI API Key'));
  const model = String(getRequiredConfig('model', 'AI Model'));
  const timeoutMs = Number(aiConfig.timeoutMs ?? 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = new Date().toISOString();
  const userMessage = {
    id: createId('message'),
    session_id: params.sessionId,
    role: 'user' as const,
    content: params.content,
    created_at: now
  };

  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at)
    VALUES (@id, @session_id, @role, @content, @created_at)
  `).run(userMessage);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是一个桌面 AI 助手。用户可能会在消息中提到本地文件名或文件夹名，但你不能读取本地文件内容。请只根据用户输入的文字回答。如果需要文件内容，请提醒用户把内容粘贴到对话中。'
          },
          ...params.history.slice(-20),
          {
            role: 'user',
            content: params.content
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`AI 接口请求失败：${response.status}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      throw new Error('AI 返回内容为空');
    }

    const assistantMessage = {
      id: createId('message'),
      session_id: params.sessionId,
      role: 'assistant' as const,
      content,
      created_at: new Date().toISOString()
    };

    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (@id, @session_id, @role, @content, @created_at)
    `).run(assistantMessage);
    db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(
      params.content.slice(0, 20) || '新会话',
      assistantMessage.created_at,
      params.sessionId
    );

    return {
      userMessage: mapMessage(userMessage),
      assistantMessage: mapMessage(assistantMessage)
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('AI 接口请求超时');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
});

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: '轻量级 AI 工作区连接器',
    backgroundColor: '#f4f1ea',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

void app.whenReady().then(() => {
  initDatabase();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
