// navigator.mediaSession for the Android app: the WebView's own reaches nothing outside the page, so what the player
// (app.js) tells it goes to the Playback plugin (the notification, the lock screen, Bluetooth and the headset), and
// those buttons come back as the action handlers app.js set.

const ACTIONS = { play: 'play', pause: 'pause', next: 'nexttrack', previous: 'previoustrack', seek: 'seekto' };

// (the plugin missing — a page opened outside the app — is no reason for the player to fail)
const quietly = (fn) => { try { Promise.resolve(fn()).catch(() => {}); } catch { /* not there */ } };

function createMediaSession(playback) {
  const handlers = {};
  let metadata = null, state = 'none', position = null, duration = null, sentCover = null;
  const send = (extra = {}) => {
    if (state === 'none' && !metadata) { sentCover = null; quietly(() => playback.stop()); return; }
    const m = metadata || {};
    const cover = (m.artwork && m.artwork[0] && m.artwork[0].src) || '';
    const update = { title: m.title || '', artist: m.artist || '', album: m.album || '', playing: state === 'playing', ...extra };
    if (position != null) { update.position = position; update.duration = duration; }
    if (cover !== sentCover) { update.cover = cover; sentCover = cover; } // (a data URL: sent once, not with every update)
    quietly(() => playback.update(update));
  };
  quietly(() => playback.addListener('command', ({ action, position: at }) => {
    const name = ACTIONS[action];
    const fn = name && handlers[name];
    if (fn) fn(name === 'seekto' ? { action: name, seekTime: at } : { action: name });
  }));
  return {
    get metadata() { return metadata; },
    set metadata(m) { metadata = m || null; send(); },
    get playbackState() { return state; },
    set playbackState(s) { if (s === state) return; state = s; send(); },
    setActionHandler(action, fn) { if (fn) handlers[action] = fn; else delete handlers[action]; },
    setPositionState(p) {
      if (!p) { position = duration = null; return; }
      if (!(p.duration >= 0) || !(p.position >= 0) || p.position > p.duration) throw new TypeError('Invalid position state');
      position = p.position; duration = p.duration;
      send();
    },
    setMicrophoneActive() {}, setCameraActive() {},
  };
}

class MediaMetadata {
  constructor(init = {}) {
    this.title = init.title || ''; this.artist = init.artist || ''; this.album = init.album || '';
    this.artwork = (init.artwork || []).map((a) => ({ ...a }));
  }
}

function installMediaSession(playback, nav = globalThis.navigator, global = globalThis) {
  const session = createMediaSession(playback);
  Object.defineProperty(nav, 'mediaSession', { value: session, configurable: true });
  global.MediaMetadata = MediaMetadata;
  return session;
}

module.exports = { createMediaSession, installMediaSession, MediaMetadata };
