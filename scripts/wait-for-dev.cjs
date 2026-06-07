const fs = require('fs');
const net = require('net');
const path = require('path');

const port = 5173;
const host = '127.0.0.1';
const electronEntry = path.resolve(__dirname, '../dist-electron/main.js');
const timeoutMs = 120000;
const intervalMs = 300;
const startedAt = Date.now();

function waitForPort() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForDevReady() {
  while (Date.now() - startedAt < timeoutMs) {
    const isPortReady = await waitForPort();
    const isEntryReady = fs.existsSync(electronEntry);

    if (isPortReady && isEntryReady) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Timed out waiting for Vite and Electron build output.');
}

waitForDevReady().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
