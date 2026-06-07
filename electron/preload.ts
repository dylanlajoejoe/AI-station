import { contextBridge, ipcRenderer } from 'electron';

type SelectDirectoryResult = {
  canceled: boolean;
  path: string | null;
};

type FileTreeNode = {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
  modifiedAt: string | null;
};

type TextPreviewResult = {
  content: string;
};

type SaveTextResult = {
  size: number;
  modifiedAt: string;
};

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
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
  locatedPaths: LocatedPathResult[];
  referencedFiles: ReferencedFileContent[];
};

type MessageChunk = {
  sessionId: string;
  content: string;
};

type SessionRecord = {
  id: string;
  title: string;
  workspacePath: string | null;
  createdAt: string;
  updatedAt: string;
};

type ChatMessageRecord = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type AiConfigInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

type AiConfigView = {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  hasApiKey: boolean;
};

contextBridge.exposeInMainWorld('aiWorkspace', {
  platform: process.platform,
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory') as Promise<SelectDirectoryResult>,
  listFileTree: (directoryPath: string) => ipcRenderer.invoke('fileTree:list', directoryPath) as Promise<FileTreeNode[]>,
  readTextPreview: (filePath: string) => ipcRenderer.invoke('file:readTextPreview', filePath) as Promise<TextPreviewResult>,
  saveTextFile: (params: { filePath: string; content: string }) => ipcRenderer.invoke('file:saveText', params) as Promise<SaveTextResult>,
  locatePaths: (params: { workspacePath: string | null; content: string }) => ipcRenderer.invoke('file:locatePaths', params) as Promise<LocatedPathResult[]>,
  sendMessage: (params: SendMessageParams) => ipcRenderer.invoke('chat:sendMessage', params) as Promise<SendMessageResult>,
  onMessageChunk: (callback: (chunk: MessageChunk) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: MessageChunk) => callback(chunk);

    ipcRenderer.on('chat:messageChunk', listener);

    return () => ipcRenderer.removeListener('chat:messageChunk', listener);
  },
  createSession: (params: { workspacePath: string | null }) => ipcRenderer.invoke('session:create', params) as Promise<SessionRecord>,
  listSessions: () => ipcRenderer.invoke('session:list') as Promise<SessionRecord[]>,
  getSession: (params: { sessionId: string }) => ipcRenderer.invoke('session:get', params) as Promise<{ session: SessionRecord; messages: ChatMessageRecord[] }>,
  renameSession: (params: { sessionId: string; title: string }) => ipcRenderer.invoke('session:rename', params) as Promise<{ ok: boolean }>,
  deleteSession: (params: { sessionId: string }) => ipcRenderer.invoke('session:delete', params) as Promise<{ ok: boolean }>,
  exportSessionMarkdown: (params: { sessionId: string }) => ipcRenderer.invoke('session:exportMarkdown', params) as Promise<{ ok: boolean; path: string | null }>,
  getAiConfig: () => ipcRenderer.invoke('config:getAiConfig') as Promise<AiConfigView>,
  setAiConfig: (config: AiConfigInput) => ipcRenderer.invoke('config:setAiConfig', config) as Promise<{ ok: boolean }>
});
