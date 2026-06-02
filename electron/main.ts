import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readdir, stat } from 'fs/promises';
import path from 'path';

const isDev = !app.isPackaged;

type ChatMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

type SendMessageParams = {
  content: string;
  history: ChatMessageInput[];
};

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} 未配置`);
  }

  return value;
}

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

ipcMain.handle('fileTree:list', async (_event, directoryPath: string) => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nodes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      const entryStat = await stat(entryPath);

      return {
        id: entryPath,
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? entryStat.size : null,
        modifiedAt: entryStat.mtime.toISOString()
      };
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
  const baseUrl = getRequiredEnv('AI_BASE_URL').replace(/\/$/, '');
  const apiKey = getRequiredEnv('AI_API_KEY');
  const model = getRequiredEnv('AI_MODEL');
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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

    return { content };
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
