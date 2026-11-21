// Electron, for the desktop's main process running in the page (Android). The one "window" is this page; what a
// phone has no use for (menus, docks, taskbars, extra windows) does nothing; dialogs are the phone's own (pickers and
// questions), set by boot.entry.js.

const { ipcMain, ipcRenderer, toPage, setSender } = require('./ipc.js');
const nativeImage = require('./native-image.js');

const noop = () => {};
const DATA = () => process.env.CDPLAYER_HOME;
const SHARED = '/storage/emulated/0';

let readyResolve;
const ready = new Promise((r) => { readyResolve = r; });
let isReady = false;

// A small event emitter for app, windows and webContents.
const emitter = (target) => {
  const map = new Map();
  target.on = (ev, fn) => { if (!map.has(ev)) map.set(ev, []); map.get(ev).push(fn); return target; };
  target.once = (ev, fn) => { const once = (...a) => { target.removeListener(ev, once); fn(...a); }; return target.on(ev, once); };
  target.removeListener = target.off = (ev, fn) => { const l = map.get(ev); if (l) map.set(ev, l.filter((f) => f !== fn)); return target; };
  target.removeAllListeners = (ev) => { if (ev) map.delete(ev); else map.clear(); return target; };
  target.emit = (ev, ...a) => { for (const fn of (map.get(ev) || []).slice()) { try { fn(...a); } catch (e) { console.error(`${ev}:`, e); } } return true; };
  target.listenerCount = (ev) => (map.get(ev) || []).length;
  return target;
};

const PATHS = {
  userData: () => `${DATA()}/electron-profile`, appData: () => DATA(), temp: () => `${DATA()}/tmp`, home: () => SHARED,
  music: () => `${SHARED}/Music`, downloads: () => `${SHARED}/Download`, documents: () => `${SHARED}/Documents`,
  pictures: () => `${SHARED}/Pictures`, desktop: () => `${SHARED}/Download`, logs: () => `${DATA()}/logs`, exe: () => '/app/cdplayer',
};
const app = emitter({
  isPackaged: true,
  whenReady: () => ready,
  isReady: () => isReady,
  getVersion: () => process.env.CDP_VERSION || '0.0.0',
  getName: () => 'CDPlayer',
  getLocale: () => navigator.language || 'en',
  getPreferredSystemLanguages: () => Array.from(navigator.languages || [navigator.language || 'en']),
  getPath: (name) => (PATHS[name] ? PATHS[name]() : DATA()),
  setPath: noop,
  requestSingleInstanceLock: () => true,
  quit: noop, exit: noop, focus: noop, hide: noop, show: noop,
  relaunch: () => setTimeout(() => location.reload(), 0),
  getAppMetrics: () => [], getGPUFeatureStatus: () => ({}), getGPUInfo: () => Promise.resolve({}),
  setAppUserModelId: noop, disableHardwareAcceleration: noop, setAboutPanelOptions: noop, setLoginItemSettings: noop,
  getLoginItemSettings: () => ({ openAtLogin: false }), addRecentDocument: noop, clearRecentDocuments: noop,
  commandLine: { appendSwitch: noop, hasSwitch: () => false, getSwitchValue: () => '' },
  dock: undefined,
});

// The page as the main process's window. Visibility (the app going to the background and back) comes from boot.
let theWindow = null;
let capture = null; // rect → Promise<NativeImage> (webContents.capturePage)
class BrowserWindow {
  constructor() {
    emitter(this);
    this._destroyed = false;
    this._visible = true;
    const wc = emitter({
      id: 1,
      send: (channel, ...args) => toPage(channel, ...args),
      isCrashed: () => false, isLoading: () => false, isDestroyed: () => false,
      getURL: () => 'cdp://app/index.html',
      reload: () => location.reload(),
      setWindowOpenHandler: noop, setAudioMuted: noop, setZoomFactor: noop, openDevTools: noop,
      executeJavaScript: (code) => Promise.resolve().then(() => (0, eval)(code)),
      // (SHELFIE's picture of the shelf: the phone's own copy of the screen, boot.entry.js; none before it's set)
      capturePage: (rect) => (capture ? capture(rect) : Promise.reject(new Error('capturePage: not on Android'))),
      session: { setPermissionRequestHandler: noop, setPermissionCheckHandler: noop, webRequest: { onHeadersReceived: noop } },
    });
    this.webContents = wc;
    this.id = 1;
    if (!theWindow) { theWindow = this; setSender(wc); }
  }
  static getAllWindows() { return theWindow ? [theWindow] : []; }
  static getFocusedWindow() { return theWindow; }
  static fromWebContents() { return theWindow; }
  loadURL() {
    // The page is already here: tell the main process it has loaded, once its listeners are on.
    if (this === theWindow) {
      setTimeout(() => { this.emit('ready-to-show'); this.webContents.emit('did-finish-load'); }, 0);
    } else {
      setTimeout(() => this.close(), 0); // (a second window — the mini player — has nowhere to be on a phone)
    }
    return Promise.resolve();
  }
  loadFile() { return this.loadURL(); }
  isDestroyed() { return this._destroyed; }
  close() { if (this === theWindow) return; this._destroyed = true; this.emit('close', { preventDefault: noop }); this.emit('closed'); }
  destroy() { this.close(); }
  isVisible() { return this._visible; }
  isMinimized() { return !this._visible; }
  isFocused() { return this._visible; }
  isMaximized() { return true; }
  isFullScreen() { return false; }
  getBounds() { return { x: 0, y: 0, width: innerWidth, height: innerHeight }; }
  getContentBounds() { return this.getBounds(); }
  getSize() { return [innerWidth, innerHeight]; }
  getPosition() { return [0, 0]; }
  setVisibleForPhone(visible) { // (boot.entry.js: the app going to the background and back)
    if (visible === this._visible) return;
    this._visible = visible;
    this.emit(visible ? 'show' : 'hide');
    if (visible) this.emit('focus'); else this.emit('blur');
  }
}
for (const m of ['show', 'hide', 'focus', 'blur', 'restore', 'minimize', 'maximize', 'unmaximize', 'setBounds', 'setSize', 'setPosition', 'setMinimumSize',
  'setFullScreen', 'setSkipTaskbar', 'setIcon', 'setAppDetails', 'setTitle', 'setAlwaysOnTop', 'setMenuBarVisibility', 'setProgressBar', 'setOverlayIcon',
  'setThumbarButtons', 'flashFrame', 'center', 'moveTop', 'setBackgroundColor', 'setOpacity', 'setResizable', 'setAspectRatio', 'setVibrancy']) {
  if (!BrowserWindow.prototype[m]) BrowserWindow.prototype[m] = noop;
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const nativeTheme = emitter({
  themeSource: 'system',
  get shouldUseDarkColors() { return darkQuery ? darkQuery.matches : true; },
  shouldUseHighContrastColors: false,
});

const display = () => {
  const b = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  return { id: 1, bounds: b, workArea: b, size: { width: b.width, height: b.height }, workAreaSize: { width: b.width, height: b.height }, scaleFactor: devicePixelRatio || 1, rotation: 0 };
};
const screen = emitter({
  getAllDisplays: () => [display()], getPrimaryDisplay: display, getDisplayMatching: display, getDisplayNearestPoint: display,
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
});

// (the phone's browser, set by boot.entry.js: a WebView's window.open opens nothing)
let opener = null;
const openExternal = (url) => {
  if (opener) return opener(String(url)).catch(() => {});
  try { window.open(String(url), '_blank'); } catch { /* nothing to open it with */ }
  return Promise.resolve();
};
const shell = {
  openExternal, openPath: () => Promise.resolve('Not on Android'), showItemInFolder: noop, beep: noop,
  trashItem: () => Promise.reject(new Error('trashItem: not on Android')),
  readShortcutLink: () => { throw new Error('not on Android'); }, writeShortcutLink: () => false,
};

// Dialogs, through the phone's own (boot.entry.js sets `files` — Phone's pickFiles / createFile / ask): a file to open
// comes as a copy in files/picked/; one to save is written in files/saving/ by the desktop's code and then put where the
// user chose (fs.js's afterWrite). A folder (TAKE ALONG's) comes as its path in shared storage.
// Without them (tests), every dialog is cancelled and a question gets its default button.
let files = null;
const MIME = { m3u: 'audio/x-mpegurl', m3u8: 'audio/x-mpegurl', png: 'image/png', mp4: 'video/mp4', webm: 'video/webm', json: 'application/json', csv: 'text/csv', xml: 'text/xml', zip: 'application/zip' };
const opts = (a, b) => (b || (a && !a.webContents && !a.isDestroyed ? a : {})) || {};
// (the main process's text, in the interface's language — loaded when first needed)
const t = (...args) => require('../../main/i18n').t(...args);
function ownNewest(o) {
  const fs = require('fs'), dir = String(o.defaultPath || ''), exts = (o.filters || []).flatMap((f) => f.extensions || []);
  if (typeof fs.__filesDir !== 'function' || !dir.startsWith(`${fs.__filesDir()}/`) || !exts.length) return null;
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => exts.some((x) => n.toLowerCase().endsWith(`.${x}`))).sort(); } catch { return null; }
  if (!names.length) return null;
  const p = `${dir}/${names[names.length - 1]}`;
  return { path: p, day: new Date(fs.statSync(p).mtimeMs).toLocaleDateString(require('../../main/i18n').current().code) };
}
const dialog = {
  async showOpenDialog(a, b) {
    const o = opts(a, b), props = o.properties || [];
    if (files && props.includes('openDirectory')) { // (a folder: TAKE ALONG's — on the phone, its card or a drive)
      try { const { path } = await files.pickFolder(); return { canceled: !path, filePaths: path ? [path] : [] }; } catch { return { canceled: true, filePaths: [] }; }
    }
    if (!files || props.includes('openDirectory')) return { canceled: true, filePaths: [] };
    // (a folder of the app's own — the daily backups' — is out of the phone's picker's reach: its newest file offered first)
    const newest = ownNewest(o);
    if (newest) {
      try {
        const { response } = await files.ask({ message: t('The one made by itself on {day}, or another file?', { day: newest.day }), detail: '',
          buttons: [t('THE ONE FROM {day}', { day: newest.day }), t('ANOTHER FILE…'), t('Cancel')], cancelId: 2 });
        if (response === 0) return { canceled: false, filePaths: [newest.path] };
        if (response !== 1) return { canceled: true, filePaths: [] };
      } catch { return { canceled: true, filePaths: [] }; }
    }
    try {
      const { paths } = await files.pick({ multiple: props.includes('multiSelections') });
      return { canceled: !paths.length, filePaths: paths };
    } catch { return { canceled: true, filePaths: [] }; }
  },
  showOpenDialogSync: () => undefined,
  async showSaveDialog(a, b) {
    const o = opts(a, b);
    if (!files) return { canceled: true, filePath: undefined };
    const name = String(o.defaultPath || 'CDPlayer').split('/').pop();
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1] || (o.filters && o.filters[0] && o.filters[0].extensions[0]) || '';
    try {
      const { uri } = await files.create({ name, mime: MIME[ext.toLowerCase()] || 'application/octet-stream' });
      if (!uri) return { canceled: true, filePath: undefined };
      const fs = require('./fs.js');
      const dir = `${fs.__filesDir()}/saving`;
      fs.mkdirSync(dir, { recursive: true });
      const filePath = `${dir}/${name.replace(/[\\/:*?"<>|]+/g, '_') || 'file'}`;
      // (the desktop's code may add the extension the name lacked: either one written is the one to put there)
      for (const p of new Set([filePath, ext && !filePath.endsWith(`.${ext}`) ? `${filePath}.${ext}` : filePath])) {
        fs.__afterWrite(p, () => files.write({ path: p, uri }).catch((e) => console.error('save failed', e)));
      }
      return { canceled: false, filePath };
    } catch { return { canceled: true, filePath: undefined }; }
  },
  showSaveDialogSync: () => undefined,
  async showMessageBox(a, b) {
    const o = opts(a, b), fallback = o.cancelId ?? o.defaultId ?? 0;
    if (!files) return { response: fallback, checkboxChecked: false };
    try {
      const { response } = await files.ask({ message: o.message || '', detail: o.detail || '', buttons: o.buttons || ['OK'], cancelId: o.cancelId ?? (o.buttons ? o.buttons.length - 1 : 0) });
      return { response, checkboxChecked: false };
    } catch { return { response: fallback, checkboxChecked: false }; }
  },
  showMessageBoxSync: (_w, o) => { const opts = o || _w || {}; return opts.cancelId ?? opts.defaultId ?? 0; },
  showErrorBox: (title, text) => console.error(title, text),
};

class ClipboardItem { constructor(items) { this.items = items; } }
const clipboard = {
  writeText: (t) => { try { navigator.clipboard.writeText(String(t)); } catch { /* not allowed */ } },
  readText: () => '', write: (o) => { if (o && o.text) clipboard.writeText(o.text); }, writeImage: noop, readImage: () => nativeImage.createEmpty(), clear: noop,
};

// Requests: through the app's native HTTP (CapacitorHttp), as Chromium's would go — no CORS in the way.
async function netFetch(input, init = {}) {
  const http = globalThis.Capacitor ? require('@capacitor/core').CapacitorHttp : null;
  if (!http) return window.fetch(input, init); // (the page's own: `fetch` and `globalThis.fetch` in this bundle are shims/fetch.js)
  const url = typeof input === 'string' ? input : input.url;
  const headers = {};
  new Headers(init.headers || (typeof input === 'object' && input.headers) || {}).forEach((v, k) => { headers[k] = v; });
  let data;
  if (init.body != null) {
    if (typeof init.body === 'string') data = init.body;
    else if (init.body instanceof URLSearchParams) { data = init.body.toString(); headers['content-type'] ||= 'application/x-www-form-urlencoded'; }
    else data = await new Response(init.body).text();
  }
  const request = http.request({ url, method: init.method || 'GET', headers, data, responseType: 'arraybuffer', connectTimeout: 20000, readTimeout: 30000 });
  const signal = init.signal;
  const aborted = signal ? new Promise((_, reject) => {
    const fail = () => reject(signal.reason || Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    if (signal.aborted) fail(); else signal.addEventListener('abort', fail, { once: true });
  }) : null;
  let r;
  try {
    r = await (aborted ? Promise.race([request, aborted]) : request);
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) throw e;
    throw new TypeError(`fetch failed: ${e && e.message}`);
  }
  const body = typeof r.data === 'string' ? Buffer.from(r.data, 'base64') : Buffer.from(JSON.stringify(r.data ?? ''));
  const nullBody = r.status === 204 || r.status === 304 || (r.status >= 100 && r.status < 200);
  const res = new Response(nullBody ? null : body, { status: r.status, headers: r.headers || {} });
  Object.defineProperty(res, 'url', { value: r.url || url });
  return res;
}

// The page's side (src/preload.js runs as it is, building window.cdp).
const contextBridge = { exposeInMainWorld: (name, api) => { globalThis[name] = api; } };
const webUtils = { getPathForFile: (file) => (file && file.path) || '' };

module.exports = {
  contextBridge, ipcRenderer, webUtils,
  app, BrowserWindow, ipcMain, nativeImage, nativeTheme, screen, shell, dialog, clipboard, ClipboardItem,
  protocol: { registerSchemesAsPrivileged: noop, handle: noop, unhandle: noop, isProtocolHandled: () => false },
  Menu: { buildFromTemplate: () => ({ popup: noop, closePopup: noop, items: [] }), setApplicationMenu: noop, getApplicationMenu: () => null },
  MenuItem: class {}, Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
  components: { whenReady: () => Promise.resolve(), status: () => ({}) },
  powerSaveBlocker: { start: () => 1, stop: noop, isStarted: () => false },
  powerMonitor: emitter({ getSystemIdleTime: () => 0, isOnBatteryPower: () => false }),
  globalShortcut: { register: () => false, unregister: noop, unregisterAll: noop, isRegistered: () => false },
  systemPreferences: emitter({ getMediaAccessStatus: () => 'granted', askForMediaAccess: () => Promise.resolve(true), getAccentColor: () => '', isDarkMode: () => nativeTheme.shouldUseDarkColors }),
  session: { defaultSession: { setPermissionRequestHandler: noop, setPermissionCheckHandler: noop, clearCache: () => Promise.resolve() } },
  net: { fetch: netFetch, isOnline: () => navigator.onLine },
  // boot.entry.js
  __setCapture: (fn) => { capture = fn; }, __setOpener: (fn) => { opener = fn; }, __setFiles: (f) => { files = f; },
  __markReady: () => { isReady = true; readyResolve(); app.emit('ready'); },
  __window: () => theWindow,
};
