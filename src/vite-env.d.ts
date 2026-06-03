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

interface Window {
  aiWorkspace: {
    platform: NodeJS.Platform;
    selectDirectory: () => Promise<{
      canceled: boolean;
      path: string | null;
    }>;
    listFileTree: (directoryPath: string) => Promise<FileTreeNode[]>;
    readTextPreview: (filePath: string) => Promise<TextPreviewResult>;
    sendMessage: (params: {
      sessionId: string;
      content: string;
      history: ChatMessageInput[];
    }) => Promise<{
      userMessage: ChatMessageRecord;
      assistantMessage: ChatMessageRecord;
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
