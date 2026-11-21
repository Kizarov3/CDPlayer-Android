// The Android app's first script (android.js, before the renderer's own): the desktop's main process and preload,
// in this page. Node's built-ins and Electron are src/android/shims (scripts/build-android.mjs).
import './shims/globals.js';
import { registerPlugin } from '@capacitor/core';
import { installMediaSession } from './media-session.js';
import { setUpPhoneUi, followTheme } from './ui/phone-ui.js';
import { createSharing } from './share.js';

process.env.CDPLAYER_HOME = globalThis.CdpNativeFs.dataDir();

const electron = require('./shims/electron.js');
require('../main/main.js'); // registers every ipcMain handler; its window is made once the app is "ready", below
require('../preload.js'); // window.cdp, from ipcRenderer
const cdp = globalThis.cdp;
cdp.platform = 'android';
// Music files straight from Capacitor's file server (the desktop's cdp:// protocol has no counterpart here).
cdp.mediaUrl = (p) => (/^https?:\/\//.test(p) ? p : globalThis.Capacitor.convertFileSrc(`file://${p}`));

installMediaSession(registerPlugin('Playback'));

// The phone's layout (ui/mobile.css): marked at once, so the first frame is already the phone's; its own pieces once
// the page is there.
document.documentElement.classList.add('android');
const phone = registerPlugin('Phone');
cdp.toBackground = () => { phone.background().catch(() => {}); };
electron.__setOpener((url) => phone.openUrl({ url }));
electron.__setFiles({ pick: (o) => phone.pickFiles(o), create: (o) => phone.createFile(o), write: (o) => phone.writeToUri(o), ask: (o) => phone.ask(o) }); // (the dialogs)
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
