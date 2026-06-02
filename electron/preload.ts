import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('aiWorkspace', {
  platform: process.platform
});
