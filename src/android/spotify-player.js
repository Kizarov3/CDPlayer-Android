// Spotify's player for the Android app: the SDK runs in a WebView of its own (SpotifyHost.java, assets/spotify/), away
// from this page and its bridges to the phone's files. This is its stand-in here — the same few calls and events
// spotify-deck.js uses of Spotify.Player (new Player({ name, volume, getOAuthToken }), addListener, connect,
// disconnect, resume, pause, seek, setVolume), passed over as messages.

export function hostedSpotify(host) {
  let current = null, opened = null, nextCall = 1;
  const calls = new Map();
  const send = (m) => host.send({ message: JSON.stringify(m) });
  host.addListener('message', ({ data }) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'result') {
      const c = calls.get(m.id);
      calls.delete(m.id);
      if (c) (m.error ? c.reject(new Error(m.error)) : c.resolve(m.value));
    } else if (m.type === 'token' && current) {
      current.getOAuthToken((token) => send({ op: 'token', id: m.id, token }));
    } else if (m.type === 'event' && current) {
      for (const fn of current.listeners[m.event] || []) fn(m.data || {});
    }
  });
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = nextCall++;
    calls.set(id, { resolve, reject });
    send({ op: 'call', id, method, args }).catch((e) => { calls.delete(id); reject(e); });
  });

  class Player {
    constructor({ name, volume, getOAuthToken }) {
      current = this;
      this.listeners = {};
      this.getOAuthToken = getOAuthToken;
      send({ op: 'create', name, volume }).catch(() => {});
    }
    addListener(event, fn) { (this.listeners[event] ||= []).push(fn); return true; }
    removeListener(event) { delete this.listeners[event]; return true; }
    connect() { return call('connect').then(Boolean, () => false); }
    disconnect() { call('disconnect').catch(() => {}); }
    resume() { return call('resume').catch(() => {}); }
    pause() { return call('pause').catch(() => {}); }
    seek(ms) { return call('seek', ms).catch(() => {}); }
    setVolume(v) { return call('setVolume', v).catch(() => {}); }
    getCurrentState() { return call('getCurrentState').catch(() => null); }
  }

  /** loadSpotifySdk's place: Player, once Spotify's script has loaded in its WebView. */
  return () => (opened ||= host.open().then(() => Player, (e) => { opened = null; throw e; }));
}
