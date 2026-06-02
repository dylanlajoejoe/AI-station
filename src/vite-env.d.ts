/// <reference types="vite/client" />

interface Window {
  aiWorkspace: {
    platform: NodeJS.Platform;
    selectDirectory: () => Promise<{
      canceled: boolean;
      path: string | null;
    }>;
  };
}
