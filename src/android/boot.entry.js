// The Android app's first script (android.js, before the renderer's own): the desktop's main process and preload,
// in this page. Node's built-ins and Electron are src/android/shims (scripts/build-android.mjs).
import './shims/globals.js';
import { registerPlugin } from '@capacitor/core';
import { installMediaSession } from './media-session.js';
import { setUpPhoneUi, followTheme } from './ui/phone-ui.js';
import { createSharing } from './share.js';
import { hostedSpotify } from './spotify-player.js';

process.env.CDPLAYER_HOME = globalThis.CdpNativeFs.dataDir();

const electron = require('./shims/electron.js');
require('../main/main.js'); // registers every ipcMain handler; its window is made once the app is "ready", below
require('../preload.js'); // window.cdp, from ipcRenderer
const cdp = globalThis.cdp;
cdp.platform = 'android';
// Music files straight from Capacitor's file server (the desktop's cdp:// protocol has no counterpart here); a streamed
// song through /_cdpstream_/, answered below by the desktop's own streaming.serveStream (StreamBridge.java).
const streaming = require('../main/streaming.js');
cdp.mediaUrl = (p) => (streaming.isStreamPage(p) ? `${location.origin}/_cdpstream_/?u=${encodeURIComponent(p)}`
  : /^https?:\/\//.test(p) ? p : globalThis.Capacitor.convertFileSrc(`file://${p}`));
// Spotify's sign-in: the phone opens its page and listens for the redirect back to 127.0.0.1:8080 itself.
const spotify = require('../main/spotify.js');
spotify.io.waitForCode = async (clientId, state) => (await phone.spotifySignIn({ url: spotify.authorizeUrl(clientId, state), state })).code;
// Spotify's player in a WebView of its own, with none of this page's bridges (spotify-player.js); the WebView has
// Widevine itself (the desktop waits for castLabs' download).
cdp.spotifyPlayer = hostedSpotify(registerPlugin('SpotifyHost'));
electron.ipcMain.handle('spotify:drmReady', async () => true);
// YouTube Music, YouTube and SoundCloud: what streaming.js asks yt-dlp, answered by NewPipe's extractor (StreamsPlugin.java)
const streams = registerPlugin('Streams');
require('child_process').__setYtDlp(async (args) => (await streams.run({ args })).stdout);
// The player's requests for a streamed song: the head of serveStream's answer, then a piece each time the player
// reads on (nothing more fetched once it stops), till the end or till it lets go.
const answering = new Map();
globalThis.__cdpStream = {
  async open(id, url, range) {
    const bridge = globalThis.CdpStream;
    try {
      const res = await streaming.serveStream({ headers: new Headers(range ? { range } : {}) }, new URL(url).searchParams.get('u'));
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      answering.set(id, res.body ? res.body.getReader() : null);
      bridge.head(id, res.status, JSON.stringify(headers));
    } catch { bridge.head(id, 500, '{}'); bridge.end(id); }
  },
  async more(id) {
    const bridge = globalThis.CdpStream, reader = answering.get(id);
    try {
      const { done, value } = reader ? await reader.read() : { done: true };
      if (done) { answering.delete(id); bridge.end(id); return; }
      bridge.data(id, Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'));
    } catch { answering.delete(id); bridge.end(id); }
  },
  cancel(id) { const reader = answering.get(id); answering.delete(id); if (reader) reader.cancel().catch(() => {}); },
};

installMediaSession(registerPlugin('Playback'));

// The phone's layout (ui/mobile.css): marked at once, so the first frame is already the phone's; its own pieces once
// the page is there.
document.documentElement.classList.add('android');
const phone = registerPlugin('Phone');
cdp.toBackground = () => { phone.background().catch(() => {}); };
// OUTPUT: Android's own picker, and the name of where it plays now ('' — the phone's speaker)
// MINI MODE: a small window over other apps (picture-in-picture) when the app's left while it plays — kept on this phone
cdp.phoneMini = () => { try { return localStorage.getItem('phoneMini') === '1'; } catch { return false; } };
cdp.setPhoneMini = (on) => { try { localStorage.setItem('phoneMini', on ? '1' : '0'); } catch { /* not kept */ } phone.setMiniMode({ enabled: !!on }).catch(() => {}); };
cdp.enterMiniMode = () => phone.enterMiniMode().catch(() => {});
phone.setMiniMode({ enabled: cdp.phoneMini() }).catch(() => {});
// A keyboard plugged in: the keys work as on the desktop, and KEYBOARD SHORTCUTS is offered (body.has-keyboard).
const keyboard = (on) => document.body && document.body.classList.toggle('has-keyboard', !!on);
document.addEventListener('DOMContentLoaded', () => phone.hasKeyboard().then((r) => keyboard(r.keyboard), () => {}));
document.addEventListener('cdp-keyboard-on', () => keyboard(true));
document.addEventListener('cdp-keyboard-off', () => keyboard(false));
cdp.chooseOutput = () => phone.chooseOutput().catch(() => {});
cdp.currentOutput = () => phone.currentOutput().then((r) => r.name || '', () => '');
electron.__setOpener((url) => phone.openUrl({ url }));
electron.__setFiles({ pick: (o) => phone.pickFiles(o), create: (o) => phone.createFile(o), write: (o) => phone.writeToUri(o), ask: (o) => phone.ask(o),
  // (TAKE ALONG writes into the folder itself: All files access first — its page opened, and nothing picked, if not yet)
  pickFolder: async () => ((await cdp.allowChangingFiles()) ? phone.pickFolder() : { path: null }) }); // (the dialogs)
electron.__setCapture(async (rect) => {
  const { png } = await phone.capture({ ...rect, scale: devicePixelRatio });
  return electron.nativeImage.createFromDataURL(`data:image/png;base64,${png}`);
});
// TAGS and SAVE FOUND ART & LYRICS change the songs' own files: on Android 11+ only with All files access (the APK isn't
// on Google Play, where it'd need Google's approval). → true if allowed; else its system page is opened and false.
cdp.allowChangingFiles = async () => {
  if ((await phone.canChangeFiles()).allowed) return true;
  phone.askToChangeFiles().catch(() => {});
  return false;
};
// The update pill as on the desktop: a tap downloads the release's APK (checked: size, SHA-256, this app and newer),
// the next opens Android's installer on it — which the first time asks to let CDPlayer install apps (false: app.js says so).
const updates = require('../main/updates.js');
updates.installPlan = () => ({ kind: 'replace', target: 'apk' });
updates.downloadAsset = async (asset, _dir, onProgress = () => {}) => {
  const listening = await phone.addListener('updateProgress', ({ fraction }) => onProgress(fraction));
  try {
    const { path } = await phone.downloadUpdate({ url: asset.url, name: asset.name, size: asset.size || 0, sha256: asset.sha256 || '' });
    onProgress(1);
    return path;
  } finally { listening.remove(); }
};
updates.startInstaller = async () => !!(await phone.installUpdate()).started;
// TAKE ALONG: a song copied by the phone (off the page's thread), made MP3 in a Web Worker that reads it by its address.
const takeAlongLib = require('../main/take-along.js');
takeAlongLib.io.copy = async (src, temp, signal) => {
  if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
  try { await phone.copyFile({ from: src, to: temp }); } catch (e) { throw Object.assign(new Error(e.message), { code: e.code }); }
};
let mp3Worker = null, mp3Id = 1;
const mp3Jobs = new Map();
takeAlongLib.io.convert = ({ src, kind, from, to }, signal) => new Promise((resolve, reject) => {
  const cancelled = () => Object.assign(new Error('cancelled'), { reason: 'cancelled' });
  if (signal && signal.aborted) { reject(cancelled()); return; }
  if (!mp3Worker) {
    const w = mp3Worker = new Worker('workers/take-along-worker.js');
    w.onmessage = ({ data: { id, file, error } }) => {
      const job = mp3Jobs.get(id);
      if (!job) return;
      mp3Jobs.delete(id);
      error ? job.reject(new Error(error)) : job.resolve(Buffer.from(file));
    };
    w.onerror = (e) => { e.preventDefault(); if (mp3Worker !== w) return; mp3Worker = null; for (const j of mp3Jobs.values()) j.reject(new Error(e.message || 'the encoder stopped')); mp3Jobs.clear(); };
  }
  const id = mp3Id++, w = mp3Worker;
  mp3Jobs.set(id, { resolve, reject });
  if (signal) {
    signal.addEventListener('abort', () => { // (a cancel stops it at once)
      if (!mp3Jobs.has(id) || mp3Worker !== w) return;
      mp3Jobs.delete(id);
      mp3Worker = null;
      w.terminate();
      reject(cancelled());
    }, { once: true });
  }
  const st = require('fs').statSync(src);
  w.postMessage({ id, url: cdp.mediaUrl(src), stamp: `${st.size}:${st.mtimeMs}`, kind, from, to });
});
Object.assign(cdp, createSharing({ fs: require('fs'), dataDir: process.env.CDPLAYER_HOME, phone })); // (share sheet, gallery)
document.addEventListener('DOMContentLoaded', () => {
  setUpPhoneUi();
  followTheme((bars) => { phone.setBars(bars).catch(() => {}); });
});

electron.__markReady();

// The app in the background and back (MainActivity's onPause/onResume): the main process's window hidden and shown
// (it tells the page, which stops drawing what nobody sees).
document.addEventListener('cdp-pause', () => { const w = electron.__window(); if (w) w.setVisibleForPhone(false); });
document.addEventListener('cdp-resume', () => { const w = electron.__window(); if (w) w.setVisibleForPhone(true); });
// (the small window is paused but seen: it's drawn)
document.addEventListener('cdp-pip-on', () => { const w = electron.__window(); if (w) w.setVisibleForPhone(true); });
