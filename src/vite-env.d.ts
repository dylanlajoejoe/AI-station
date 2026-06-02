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
  };
}
