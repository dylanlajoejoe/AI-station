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

type ChatMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

type SendMessageParams = {
  sessionId: string;
  content: string;
  history: ChatMessageInput[];
};

type SendMessageResult = {
  userMessage: ChatMessageRecord;
  assistantMessage: ChatMessageRecord;
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
  sendMessage: (params: SendMessageParams) => ipcRenderer.invoke('chat:sendMessage', params) as Promise<SendMessageResult>,
  createSession: (params: { workspacePath: string | null }) => ipcRenderer.invoke('session:create', params) as Promise<SessionRecord>,
  listSessions: () => ipcRenderer.invoke('session:list') as Promise<SessionRecord[]>,
  getSession: (params: { sessionId: string }) => ipcRenderer.invoke('session:get', params) as Promise<{ session: SessionRecord; messages: ChatMessageRecord[] }>,
  getAiConfig: () => ipcRenderer.invoke('config:getAiConfig') as Promise<AiConfigView>,
  setAiConfig: (config: AiConfigInput) => ipcRenderer.invoke('config:setAiConfig', config) as Promise<{ ok: boolean }>
});
