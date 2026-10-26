// Lister for Windows: wraps the web app (../app) in its own window, keeps running in the
// system tray when the window is closed, and shows a small always-on-top focus timer in the
// bottom-right corner while Lister is minimized or closed.
const { app, BrowserWindow, protocol, net, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'app');
const ICON = path.join(__dirname, 'build', 'icon.png');

// serve the app from lister://app/ so browser storage, fetch and notifications behave like a website
protocol.registerSchemesAsPrivileged([
  { scheme: 'lister', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.lister.app');

let win = null, widget = null, tray = null, quitting = false, timer = null, toldAboutTray = false;

function showMain() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createMain() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 380, minHeight: 520,
    title: 'Lister', icon: ICON, backgroundColor: '#0c0f15', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.loadURL('lister://app/index.html#tasks');
  // closing the window hides it; Lister keeps running in the tray so the timer and reminders continue
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!toldAboutTray && tray) {
      toldAboutTray = true;
      tray.displayBalloon({ title: 'Lister is still running', content: 'Your timer and reminders keep going. Right-click the Lister icon near the clock to quit.', iconType: 'info' });
    }
  });
  for (const ev of ['minimize', 'restore', 'show', 'hide']) win.on(ev, updateWidget);
  // links to other websites open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createWidget() {
  widget = new BrowserWindow({
    width: 300, height: 164, frame: false, transparent: true, resizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Lister timer',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  widget.setAlwaysOnTop(true, 'floating');
  widget.loadURL('lister://app/desktop-widget.html');
  const wa = screen.getPrimaryDisplay().workArea;
  widget.setPosition(wa.x + wa.width - 300 - 8, wa.y + wa.height - 164 - 8);
  widget.webContents.on('did-finish-load', () => { if (timer) widget.webContents.send('timer', timer); });
}

function updateWidget() {
  if (!widget || !win) return;
  const active = timer && (timer.running || timer.remaining < timer.length);
  const away = !win.isVisible() || win.isMinimized();
  if (active && away) { if (!widget.isVisible()) widget.showInactive(); }
  else if (widget.isVisible()) widget.hide();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Lister');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lister', click: showMain },
    { type: 'separator' },
    { label: 'Quit Lister', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showMain);
}

// the app window sends its timer whenever it changes
ipcMain.on('timer', (_e, t) => {
  timer = t;
  if (widget) widget.webContents.send('timer', t);
  updateWidget();
});
// buttons on the corner timer
ipcMain.on('widget-action', (_e, action) => {
  if (action === 'open') showMain();
  else if (win) win.webContents.send('widget-action', action);
});

app.on('second-instance', showMain);
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  protocol.handle('lister', req => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(WEB, p));
    if (!file.startsWith(WEB)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createMain();
  createWidget();
  createTray();
});
app.on('window-all-closed', e => e.preventDefault());
