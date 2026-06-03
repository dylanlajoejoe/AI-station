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
  message: string;
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
    locatePaths: (params: {
      workspacePath: string | null;
      content: string;
      allowSensitivePaths: boolean;
    }) => Promise<LocatedPathResult[]>;
    sendMessage: (params: {
      sessionId: string;
      content: string;
      history: ChatMessageInput[];
      workspacePath: string | null;
      locatedPaths: LocatedPathResult[];
      referencedFiles: ReferencedFileInput[];
      allowSensitivePaths: boolean;
    }) => Promise<{
      userMessage: ChatMessageRecord;
      assistantMessage: ChatMessageRecord;
      locatedPaths: LocatedPathResult[];
      referencedFiles: ReferencedFileContent[];
    }>;
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
