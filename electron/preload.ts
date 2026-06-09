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
  originalHash: string;
  size: number;
  modifiedAt: string;
  isEditable: boolean;
  contentKind: 'text' | 'office';
  ocrEnabled: boolean;
};

type SaveTextResult = {
  size: number;
  modifiedAt: string;
  nextHash: string;
};

type FileEditSuggestion = {
  id: string;
  sessionId: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  filePath: string;
  targetPath: string | null;
  fileName: string;
  originalHash: string | null;
  originalContent: string | null;
  proposedContent: string | null;
  proposedHash: string | null;
  summary: string;
  status: 'suggested' | 'applied' | 'failed';
  messageId: string | null;
};

type ApplyFileEditParams = {
  sessionId: string;
  suggestionId: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  filePath: string;
  targetPath: string | null;
  expectedOriginalHash: string | null;
  proposedContent: string | null;
  sensitivePathConfirmed: boolean;
  deleteConfirmed: boolean;
  summary: string;
};

type ApplyFileEditResult = {
  ok: boolean;
  filePath: string;
  size: number;
  modifiedAt: string;
  nextHash: string;
  logId: string;
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
  originalHash: string | null;
  message: string;
};

type SaveTextFileParams = {
  workspacePath: string | null;
  filePath: string;
  expectedOriginalHash: string;
  content: string;
  sensitivePathConfirmed: boolean;
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
  fileEditSuggestion: FileEditSuggestion | null;
};

type SessionEventRecord = {
  id: string;
  sessionId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};

type SessionMemoryDebug = {
  taskState: unknown;
  taskStateUpdatedAt: string | null;
  contextPack: unknown;
  contextPackCreatedAt: string | null;
  rollingSummary: {
    id: string;
    summary: string;
    fromMessageId: string | null;
    toMessageId: string | null;
    updatedAt: string;
  } | null;
  files: Array<{
    id: string;
    path: string;
    operation: string;
    reason: string | null;
    updatedAt: string;
  }>;
  commands: Array<{
    id: string;
    command: string;
    cwd: string | null;
    exitCode: number | null;
    status: string;
    importantOutput: unknown;
    createdAt: string;
  }>;
};

type MessageChunk = {
  sessionId: string;
  content: string;
};

type WorkspaceChangeEvent = {
  workspacePath: string | null;
  path: string | null;
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
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text) as Promise<{ ok: boolean }>,
  listFileTree: (directoryPath: string) => ipcRenderer.invoke('fileTree:list', directoryPath) as Promise<FileTreeNode[]>,
  createWorkspaceEntry: (params: { type: 'file' | 'directory'; name: string; parentPath?: string | null; workspacePath?: string | null }) => ipcRenderer.invoke('fileTree:createEntry', params) as Promise<FileTreeNode>,
  renameWorkspaceEntry: (params: { filePath: string; newName: string }) => ipcRenderer.invoke('fileTree:renameEntry', params) as Promise<FileTreeNode>,
  readTextPreview: (params: string | { filePath: string; enableOcr?: boolean }) => ipcRenderer.invoke('file:readTextPreview', params) as Promise<TextPreviewResult>,
  saveTextFile: (params: SaveTextFileParams) => ipcRenderer.invoke('file:saveText', params) as Promise<SaveTextResult>,
  applyFileEdit: (params: ApplyFileEditParams) => ipcRenderer.invoke('file:applyEdit', params) as Promise<ApplyFileEditResult>,
  locatePaths: (params: { workspacePath: string | null; content: string }) => ipcRenderer.invoke('file:locatePaths', params) as Promise<LocatedPathResult[]>,
  sendMessage: (params: SendMessageParams) => ipcRenderer.invoke('chat:sendMessage', params) as Promise<SendMessageResult>,
  stopMessage: (params: { sessionId: string }) => ipcRenderer.invoke('chat:stopMessage', params) as Promise<{ ok: boolean }>,
  onMessageChunk: (callback: (chunk: MessageChunk) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: MessageChunk) => callback(chunk);

    ipcRenderer.on('chat:messageChunk', listener);

    return () => ipcRenderer.removeListener('chat:messageChunk', listener);
  },
  onWorkspaceChanged: (callback: (event: WorkspaceChangeEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, workspaceEvent: WorkspaceChangeEvent) => callback(workspaceEvent);

    ipcRenderer.on('workspace:changed', listener);

    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },
  createSession: (params: { workspacePath: string | null }) => ipcRenderer.invoke('session:create', params) as Promise<SessionRecord>,
  listSessions: () => ipcRenderer.invoke('session:list') as Promise<SessionRecord[]>,
  getSession: (params: { sessionId: string }) => ipcRenderer.invoke('session:get', params) as Promise<{ session: SessionRecord; messages: ChatMessageRecord[] }>,
  getSessionEvents: (params: { sessionId: string }) => ipcRenderer.invoke('session:getEvents', params) as Promise<SessionEventRecord[]>,
  getSessionMemory: (params: { sessionId: string }) => ipcRenderer.invoke('session:getMemory', params) as Promise<SessionMemoryDebug>,
  renameSession: (params: { sessionId: string; title: string }) => ipcRenderer.invoke('session:rename', params) as Promise<{ ok: boolean }>,
  deleteSession: (params: { sessionId: string }) => ipcRenderer.invoke('session:delete', params) as Promise<{ ok: boolean }>,
  exportSessionMarkdown: (params: { sessionId: string }) => ipcRenderer.invoke('session:exportMarkdown', params) as Promise<{ ok: boolean; path: string | null }>,
  getAiConfig: () => ipcRenderer.invoke('config:getAiConfig') as Promise<AiConfigView>,
  setAiConfig: (config: AiConfigInput) => ipcRenderer.invoke('config:setAiConfig', config) as Promise<{ ok: boolean }>
});
