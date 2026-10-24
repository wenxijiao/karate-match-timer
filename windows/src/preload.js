'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('karate', {
  getState: () => ipcRenderer.invoke('get-state'),
  getMusic: () => ipcRenderer.invoke('get-music'),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  onBell: (callback) => ipcRenderer.on('bell', () => callback()),
  send: (action) => ipcRenderer.send('action', action),
  key: (code, key) => ipcRenderer.send('key', { code, key }),
});
