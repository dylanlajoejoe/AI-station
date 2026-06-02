import { contextBridge, ipcRenderer } from 'electron';

type SelectDirectoryResult = {
  canceled: boolean;
  path: string | null;
};

contextBridge.exposeInMainWorld('aiWorkspace', {
  platform: process.platform,
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory') as Promise<SelectDirectoryResult>
});
