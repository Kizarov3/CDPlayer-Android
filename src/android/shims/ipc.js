// The IPC between the desktop's main process and its page, when both run in the same page (Android): ipcMain's handlers
// and listeners on one side, ipcRenderer's on the other, and the window's webContents.send in between. Arguments and
// answers are copied (structuredClone) as Electron's IPC copies them, so neither side keeps a live object of the other.

const handlers = new Map(); // channel → (event, ...args) => result      (ipcMain.handle)
const mainListeners = new Map(); // channel → [(event, ...args) => void]  (ipcMain.on)
const pageListeners = new Map(); // channel → [(event, ...args) => void]  (ipcRenderer.on)

const copy = (v) => {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  try { return structuredClone(v); } catch { return v; } // (what can't be copied is passed as it is)
};
const add = (map, channel, fn) => { if (!map.has(channel)) map.set(channel, []); map.get(channel).push(fn); };
const remove = (map, channel, fn) => { const l = map.get(channel); if (l) map.set(channel, l.filter((f) => f !== fn)); };

let sender = null; // the page's webContents, as the main side sees it (set by the electron shim's window)
const event = () => ({ sender, senderFrame: null, reply: (ch, ...a) => toPage(ch, ...a), returnValue: undefined });

// Main side
const ipcMain = {
  handle(channel, fn) { handlers.set(channel, fn); },
  handleOnce(channel, fn) { handlers.set(channel, (...a) => { handlers.delete(channel); return fn(...a); }); },
  removeHandler(channel) { handlers.delete(channel); },
  on(channel, fn) { add(mainListeners, channel, fn); return ipcMain; },
  once(channel, fn) { const once = (...a) => { remove(mainListeners, channel, once); fn(...a); }; add(mainListeners, channel, once); return ipcMain; },
  removeListener(channel, fn) { remove(mainListeners, channel, fn); return ipcMain; },
  removeAllListeners(channel) { if (channel) mainListeners.delete(channel); else mainListeners.clear(); return ipcMain; },
};
function toPage(channel, ...args) {
  const list = pageListeners.get(channel);
  if (!list) return;
  const copied = args.map(copy);
  for (const fn of list.slice()) setTimeout(() => fn({ sender: null }, ...copied), 0); // (async, as IPC is)
}

// Page side
const ipcRenderer = {
  invoke(channel, ...args) {
    const fn = handlers.get(channel);
    if (!fn) return Promise.reject(new Error(`No handler registered for '${channel}'`));
    const copied = args.map(copy);
    return new Promise((resolve, reject) => {
      setTimeout(() => { // (a turn of the event loop, as IPC takes)
        try { Promise.resolve(fn(event(), ...copied)).then((r) => resolve(copy(r)), reject); } catch (e) { reject(e); }
      }, 0);
    });
  },
  send(channel, ...args) {
    const list = mainListeners.get(channel);
    if (!list) return;
    const copied = args.map(copy);
    for (const fn of list.slice()) setTimeout(() => { try { fn(event(), ...copied); } catch (e) { console.error(`${channel}:`, e); } }, 0);
  },
  sendSync(channel, ...args) {
    const list = mainListeners.get(channel);
    if (!list || !list.length) return undefined;
    const e = event();
    for (const fn of list.slice()) fn(e, ...args.map(copy));
    return copy(e.returnValue);
  },
  on(channel, fn) { add(pageListeners, channel, fn); return ipcRenderer; },
  once(channel, fn) { const once = (...a) => { remove(pageListeners, channel, once); fn(...a); }; add(pageListeners, channel, once); return ipcRenderer; },
  removeListener(channel, fn) { remove(pageListeners, channel, fn); return ipcRenderer; },
  removeAllListeners(channel) { if (channel) pageListeners.delete(channel); else pageListeners.clear(); return ipcRenderer; },
};

module.exports = { ipcMain, ipcRenderer, toPage, setSender: (s) => { sender = s; }, handlers };
