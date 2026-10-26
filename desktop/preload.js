// Bridge between the Lister pages and the Windows app: passes the focus timer to the
// corner timer and the corner timer's button presses back to the app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('listerDesktop', {
  sendTimer: t => ipcRenderer.send('timer', t),
  onTimer: cb => ipcRenderer.on('timer', (_e, t) => cb(t)),
  action: a => ipcRenderer.send('widget-action', a),
  onAction: cb => ipcRenderer.on('widget-action', (_e, a) => cb(a)),
});
