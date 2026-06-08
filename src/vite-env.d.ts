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
};

type SaveTextResult = {
  size: number;
  modifiedAt: string;
  nextHash: string;
};

type FileEditSuggestion = {
  id: string;
  sessionId: string;
  filePath: string;
  fileName: string;
  originalHash: string;
  proposedContent: string;
  proposedHash: string;
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

interface Window {
  aiWorkspace: {
    platform: NodeJS.Platform;
    selectDirectory: () => Promise<{
      canceled: boolean;
      path: string | null;
    }>;
    listFileTree: (directoryPath: string) => Promise<FileTreeNode[]>;
    readTextPreview: (filePath: string) => Promise<TextPreviewResult>;
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
      filePath: string;
      expectedOriginalHash: string;
      proposedContent: string;
      sensitivePathConfirmed: boolean;
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
    onMessageChunk: (callback: (chunk: MessageChunk) => void) => () => void;
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
