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
  modifiedAt: string;
};

type ChatMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

type SendMessageParams = {
  content: string;
  history: ChatMessageInput[];
};

type SendMessageResult = {
  content: string;
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
  getAiConfig: () => ipcRenderer.invoke('config:getAiConfig') as Promise<AiConfigView>,
  setAiConfig: (config: AiConfigInput) => ipcRenderer.invoke('config:setAiConfig', config) as Promise<{ ok: boolean }>
});
