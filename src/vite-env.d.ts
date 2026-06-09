/// <reference types="vite/client" />

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

type ApplyFileEditResult = {
  ok: boolean;
  filePath: string;
  size: number;
  modifiedAt: string;
  nextHash: string;
  logId: string;
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

type MessageChunk = {
  sessionId: string;
  content: string;
};

type WorkspaceChangeEvent = {
  workspacePath: string | null;
  path: string | null;
};

interface Window {
  aiWorkspace: {
    platform: NodeJS.Platform;
    selectDirectory: () => Promise<{
      canceled: boolean;
      path: string | null;
    }>;
    writeClipboardText: (text: string) => Promise<{
      ok: boolean;
    }>;
    listFileTree: (directoryPath: string) => Promise<FileTreeNode[]>;
    createWorkspaceEntry: (params: {
      type: 'file' | 'directory';
      name: string;
      parentPath?: string | null;
      workspacePath?: string | null;
    }) => Promise<FileTreeNode>;
    renameWorkspaceEntry: (params: {
      filePath: string;
      newName: string;
    }) => Promise<FileTreeNode>;
    readTextPreview: (params: string | {
      filePath: string;
      enableOcr?: boolean;
    }) => Promise<TextPreviewResult>;
    saveTextFile: (params: {
      workspacePath: string | null;
      filePath: string;
      expectedOriginalHash: string;
      content: string;
      sensitivePathConfirmed: boolean;
    }) => Promise<SaveTextResult>;
    applyFileEdit: (params: {
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
    }) => Promise<ApplyFileEditResult>;
    locatePaths: (params: {
      workspacePath: string | null;
      content: string;
    }) => Promise<LocatedPathResult[]>;
    sendMessage: (params: {
      sessionId: string;
      content: string;
      history: ChatMessageInput[];
      workspacePath: string | null;
      locatedPaths: LocatedPathResult[];
      referencedFiles: ReferencedFileInput[];
    }) => Promise<{
      userMessage: ChatMessageRecord;
      assistantMessage: ChatMessageRecord;
      locatedPaths: LocatedPathResult[];
      referencedFiles: ReferencedFileContent[];
      fileEditSuggestion: FileEditSuggestion | null;
    }>;
    stopMessage: (params: {
      sessionId: string;
    }) => Promise<{
      ok: boolean;
    }>;
    onMessageChunk: (callback: (chunk: MessageChunk) => void) => () => void;
    onWorkspaceChanged: (callback: (event: WorkspaceChangeEvent) => void) => () => void;
    createSession: (params: {
      workspacePath: string | null;
    }) => Promise<SessionRecord>;
    listSessions: () => Promise<SessionRecord[]>;
    getSession: (params: {
      sessionId: string;
    }) => Promise<{
      session: SessionRecord;
      messages: ChatMessageRecord[];
    }>;
    getSessionEvents: (params: {
      sessionId: string;
    }) => Promise<SessionEventRecord[]>;
    getSessionMemory: (params: {
      sessionId: string;
    }) => Promise<SessionMemoryDebug>;
    renameSession: (params: {
      sessionId: string;
      title: string;
    }) => Promise<{
      ok: boolean;
    }>;
    deleteSession: (params: {
      sessionId: string;
    }) => Promise<{
      ok: boolean;
    }>;
    exportSessionMarkdown: (params: {
      sessionId: string;
    }) => Promise<{
      ok: boolean;
      path: string | null;
    }>;
    getAiConfig: () => Promise<{
      baseUrl: string;
      model: string;
      timeoutMs: number;
      hasApiKey: boolean;
    }>;
    setAiConfig: (config: AiConfigInput) => Promise<{
      ok: boolean;
    }>;
  };
}
