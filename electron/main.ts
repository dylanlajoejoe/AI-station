import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { readFile, readdir, stat } from 'fs/promises';
import path from 'path';

const isDev = !app.isPackaged;
const maxPreviewFileSize = 1024 * 1024;
const previewableTextExtensions = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.log'
]);

type ChatMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

type SendMessageParams = {
  sessionId: string;
  content: string;
  history: ChatMessageInput[];
  workspacePath: string | null;
  locatedPaths: LocatedPathResult[];
  referencedFiles: ReferencedFileInput[];
  allowSensitivePaths: boolean;
};

type ReferencedFileInput = {
  name: string;
  path: string;
  type: 'file' | 'directory';
};

type ReferencedFileContent = {
  name: string;
  path: string;
  status: 'read' | 'skipped';
  content: string | null;
  message: string;
};

type WorkspaceTreeEntry = {
  depth: number;
  name: string;
  type: 'file' | 'directory';
  size: number | null;
  modifiedAt: string | null;
};

type LocatedPathResult = {
  input: string;
  status: 'found' | 'not_found' | 'outside_workspace' | 'filtered';
  path: string | null;
  name: string | null;
  type: 'file' | 'directory' | null;
  size: number | null;
  modifiedAt: string | null;
  message: string;
};

type SendMessageResult = {
  userMessage: ReturnType<typeof mapMessage>;
  assistantMessage: ReturnType<typeof mapMessage>;
  locatedPaths: LocatedPathResult[];
  referencedFiles: ReferencedFileContent[];
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

const maxWorkspaceTreeEntries = 300;
const maxWorkspaceTreeDepth = 3;
const sensitiveFileNames = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  'credentials.json',
  'secrets.json',
  'id_rsa',
  'id_ed25519'
]);
const ignoredDirectoryNames = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  '.vite'
]);

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

function shouldHideEntry(name: string, isDirectory: boolean) {
  if (name.startsWith('.')) {
    return true;
  }

  if (sensitiveFileNames.has(name.toLowerCase())) {
    return true;
  }

  return isDirectory && ignoredDirectoryNames.has(name);
}

function isInsideWorkspace(workspacePath: string, targetPath: string) {
  const relativePath = path.relative(path.resolve(workspacePath), path.resolve(targetPath));

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function hasFilteredPathSegment(workspacePath: string, targetPath: string) {
  const relativePath = path.relative(path.resolve(workspacePath), path.resolve(targetPath));
  const segments = relativePath.split(path.sep).filter(Boolean);

  return segments.some((segment, index) => {
    const isDirectory = index < segments.length - 1;
    return shouldHideEntry(segment, isDirectory);
  });
}

function normalizePathCandidate(candidate: string) {
  return candidate.trim().replace(/^["'“”‘’]+|["'“”‘’，。；;）)]+$/g, '');
}

function extractPathCandidates(content: string) {
  const candidates = new Set<string>();
  const quotedPattern = /["'“‘]([^"'”’]+)["'”’]/g;
  const pathLikePattern = /(?:[A-Za-z]:)?[^\s"'“”‘’<>|]+[\\/][^\s"'“”‘’<>|]+/g;

  for (const match of content.matchAll(quotedPattern)) {
    const candidate = normalizePathCandidate(match[1]);

    if (candidate.includes('/') || candidate.includes('\\')) {
      candidates.add(candidate);
    }
  }

  for (const match of content.matchAll(pathLikePattern)) {
    candidates.add(normalizePathCandidate(match[0]));
  }

  return Array.from(candidates).filter(Boolean).slice(0, 20);
}

async function locatePathsInWorkspace(
  workspacePath: string | null,
  content: string,
  allowSensitivePaths: boolean
): Promise<LocatedPathResult[]> {
  if (!workspacePath) {
    return [];
  }

  const candidates = extractPathCandidates(content);
  const results: LocatedPathResult[] = [];

  for (const candidate of candidates) {
    const targetPath = path.isAbsolute(candidate) ? candidate : path.join(workspacePath, candidate);
    const resolvedPath = path.resolve(targetPath);

    if (!isInsideWorkspace(workspacePath, resolvedPath)) {
      results.push({
        input: candidate,
        status: 'outside_workspace',
        path: null,
        name: null,
        type: null,
        size: null,
        modifiedAt: null,
        message: '路径超出当前工作区，已拒绝定位'
      });
      continue;
    }

    if (!allowSensitivePaths && hasFilteredPathSegment(workspacePath, resolvedPath)) {
      results.push({
        input: candidate,
        status: 'filtered',
        path: null,
        name: null,
        type: null,
        size: null,
        modifiedAt: null,
        message: '路径包含隐藏或敏感条目，已拒绝定位'
      });
      continue;
    }

    try {
      const targetStat = await stat(resolvedPath);
      const isDirectory = targetStat.isDirectory();

      results.push({
        input: candidate,
        status: 'found',
        path: resolvedPath,
        name: path.basename(resolvedPath),
        type: isDirectory ? 'directory' : 'file',
        size: targetStat.isFile() ? targetStat.size : null,
        modifiedAt: targetStat.mtime.toISOString(),
        message: '已在当前工作区定位到该路径'
      });
    } catch {
      results.push({
        input: candidate,
        status: 'not_found',
        path: resolvedPath,
        name: path.basename(resolvedPath),
        type: null,
        size: null,
        modifiedAt: null,
        message: '当前工作区内未找到该路径'
      });
    }
  }

  return results;
}

function formatLocatedPaths(results: LocatedPathResult[]) {
  if (results.length === 0) {
    return '用户消息中未识别到可定位的文件路径。';
  }

  return results.map((result) => {
    if (result.status !== 'found') {
      return `- ${result.input}: ${result.message}`;
    }

    const kind = result.type === 'directory' ? '文件夹' : '文件';
    const size = result.size === null ? '-' : `${result.size} bytes`;
    const modifiedAt = result.modifiedAt ?? '-';

    return `- ${result.input}: 已定位 ${kind} ${result.path} (size: ${size}, modified: ${modifiedAt})`;
  }).join('\n');
}

async function readReferencedFiles(
  workspacePath: string | null,
  referencedFiles: ReferencedFileInput[],
  allowSensitivePaths: boolean
): Promise<ReferencedFileContent[]> {
  if (!workspacePath) {
    return referencedFiles.map((file) => ({
      name: file.name,
      path: file.path,
      status: 'skipped',
      content: null,
      message: '未选择工作区，无法读取引用文件'
    }));
  }

  const results: ReferencedFileContent[] = [];

  for (const file of referencedFiles.slice(0, 10)) {
    const resolvedPath = path.resolve(file.path);

    if (!isInsideWorkspace(workspacePath, resolvedPath)) {
      results.push({
        name: file.name,
        path: file.path,
        status: 'skipped',
        content: null,
        message: '引用文件超出当前工作区，已拒绝读取'
      });
      continue;
    }

    if (!allowSensitivePaths && hasFilteredPathSegment(workspacePath, resolvedPath)) {
      results.push({
        name: file.name,
        path: file.path,
        status: 'skipped',
        content: null,
        message: '引用文件包含隐藏或敏感路径，已拒绝读取'
      });
      continue;
    }

    try {
      const fileStat = await stat(resolvedPath);

      if (!fileStat.isFile()) {
        results.push({
          name: file.name,
          path: resolvedPath,
          status: 'skipped',
          content: null,
          message: '引用的是文件夹，暂不读取内容'
        });
        continue;
      }

      if (fileStat.size > maxPreviewFileSize) {
        results.push({
          name: file.name,
          path: resolvedPath,
          status: 'skipped',
          content: null,
          message: '文件超过 1MB，已拒绝读取'
        });
        continue;
      }

      const extension = path.extname(resolvedPath).toLowerCase();

      if (!previewableTextExtensions.has(extension)) {
        results.push({
          name: file.name,
          path: resolvedPath,
          status: 'skipped',
          content: null,
          message: '该文件类型暂不支持读取'
        });
        continue;
      }

      results.push({
        name: file.name,
        path: resolvedPath,
        status: 'read',
        content: await readFile(resolvedPath, 'utf8'),
        message: '已读取引用文件内容'
      });
    } catch {
      results.push({
        name: file.name,
        path: resolvedPath,
        status: 'skipped',
        content: null,
        message: '引用文件不存在或无法读取'
      });
    }
  }

  if (referencedFiles.length > 10) {
    results.push({
      name: '引用文件数量限制',
      path: '',
      status: 'skipped',
      content: null,
      message: '最多读取前 10 个引用文件，其余已跳过'
    });
  }

  return results;
}

function formatReferencedFiles(files: ReferencedFileContent[]) {
  if (files.length === 0) {
    return '用户未引用文件。';
  }

  return files.map((file) => {
    if (file.status !== 'read') {
      return `### ${file.name}\n路径：${file.path || '-'}\n状态：${file.message}`;
    }

    return `### ${file.name}\n路径：${file.path}\n状态：${file.message}\n内容：\n${file.content}`;
  }).join('\n\n');
}

function formatWorkspaceTree(entries: WorkspaceTreeEntry[], wasTruncated: boolean) {
  if (entries.length === 0) {
    return '当前工作区目录结构为空，或所有条目均被安全规则过滤。';
  }

  const lines = entries.map((entry) => {
    const indent = '  '.repeat(entry.depth);
    const kind = entry.type === 'directory' ? '文件夹' : '文件';
    const size = entry.size === null ? '-' : `${entry.size} bytes`;
    const modifiedAt = entry.modifiedAt ?? '-';

    return `${indent}- ${entry.name} (${kind}, size: ${size}, modified: ${modifiedAt})`;
  });

  if (wasTruncated) {
    lines.push(`- 已达到 ${maxWorkspaceTreeEntries} 项上限，后续目录结构已省略。`);
  }

  return lines.join('\n');
}

async function collectWorkspaceTree(rootPath: string) {
  const entries: WorkspaceTreeEntry[] = [];
  let wasTruncated = false;

  async function walk(directoryPath: string, depth: number) {
    if (entries.length >= maxWorkspaceTreeEntries) {
      wasTruncated = true;
      return;
    }

    if (depth > maxWorkspaceTreeDepth) {
      return;
    }

    let directoryEntries;

    try {
      directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }

    const visibleEntries = directoryEntries
      .filter((entry) => !shouldHideEntry(entry.name, entry.isDirectory()))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }

        return left.name.localeCompare(right.name, 'zh-CN');
      });

    for (const entry of visibleEntries) {
      if (entries.length >= maxWorkspaceTreeEntries) {
        wasTruncated = true;
        return;
      }

      const entryPath = path.join(directoryPath, entry.name);
      const isDirectory = entry.isDirectory();

      try {
        const entryStat = await stat(entryPath);
        entries.push({
          depth,
          name: entry.name,
          type: isDirectory ? 'directory' : 'file',
          size: entry.isFile() ? entryStat.size : null,
          modifiedAt: entryStat.mtime.toISOString()
        });
      } catch {
        entries.push({
          depth,
          name: entry.name,
          type: isDirectory ? 'directory' : 'file',
          size: null,
          modifiedAt: null
        });
      }

      if (isDirectory) {
        await walk(entryPath, depth + 1);
      }
    }
  }

  await walk(rootPath, 0);

  return {
    entries,
    wasTruncated
  };
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
    entries.filter((entry) => !shouldHideEntry(entry.name, entry.isDirectory())).map(async (entry) => {
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

ipcMain.handle('file:readTextPreview', async (_event, filePath: string) => {
  const fileStat = await stat(filePath);

  if (!fileStat.isFile()) {
    throw new Error('当前选择的不是文件');
  }

  if (fileStat.size > maxPreviewFileSize) {
    throw new Error('文件超过 1MB，暂不直接预览');
  }

  const extension = path.extname(filePath).toLowerCase();

  if (!previewableTextExtensions.has(extension)) {
    throw new Error('该文件类型暂不支持内容预览');
  }

  return {
    content: await readFile(filePath, 'utf8')
  };
});

ipcMain.handle('file:locatePaths', async (_event, params: { workspacePath: string | null; content: string; allowSensitivePaths: boolean }) => {
  return locatePathsInWorkspace(params.workspacePath, params.content, params.allowSensitivePaths);
});

ipcMain.handle('chat:sendMessage', async (_event, params: SendMessageParams): Promise<SendMessageResult> => {
  const baseUrl = String(getRequiredConfig('baseUrl', 'AI Base URL')).replace(/\/$/, '');
  const apiKey = String(getRequiredConfig('apiKey', 'AI API Key'));
  const model = String(getRequiredConfig('model', 'AI Model'));
  const timeoutMs = Number(aiConfig.timeoutMs ?? 30000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const now = new Date().toISOString();
  const workspaceTree = params.workspacePath ? await collectWorkspaceTree(params.workspacePath) : null;
  const workspaceTreeText = workspaceTree
    ? formatWorkspaceTree(workspaceTree.entries, workspaceTree.wasTruncated)
    : '用户尚未选择工作区目录。';
  const locatedPathsText = formatLocatedPaths(params.locatedPaths);
  const referencedFiles = await readReferencedFiles(params.workspacePath, params.referencedFiles, params.allowSensitivePaths);
  const referencedFilesText = formatReferencedFiles(referencedFiles);
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
            content: [
              '你是一个桌面 AI 助手。',
              '你可以看到用户已选择工作区的目录结构摘要，包括文件名、文件夹名、大小和修改时间。',
              '如果用户消息里包含路径，系统会先在当前工作区内真实定位路径，并把定位结果提供给你。',
              '用户显式引用的文件内容会由系统读取后提供给你。',
              '你只能使用系统提供的引用文件内容，不能假装读取未提供内容的文件。',
              '如果还需要其他文件内容，请明确要求用户引用文件或粘贴内容。',
              '不要建议扫描全盘，不要访问隐藏文件或敏感文件。',
              '',
              `当前工作区路径：${params.workspacePath ?? '未选择'}`,
              '用户消息路径定位结果：',
              locatedPathsText,
              '',
              '用户显式引用文件读取结果：',
              referencedFilesText,
              '',
              '当前工作区目录结构摘要：',
              workspaceTreeText
            ].join('\n')
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
      assistantMessage: mapMessage(assistantMessage),
      locatedPaths: params.locatedPaths,
      referencedFiles
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
