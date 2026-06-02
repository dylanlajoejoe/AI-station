/// <reference types="vite/client" />

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
    sendMessage: (params: {
      content: string;
      history: ChatMessageInput[];
    }) => Promise<{
      content: string;
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
