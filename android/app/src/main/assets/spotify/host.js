// The other side of src/android/spotify-player.js: Spotify's Web Playback SDK, driven by messages through
// CdpSpotifyHost (a WebMessageListener only this page's origin can reach — SpotifyHost.java). It holds the one player,
// asks the app for a token when the SDK wants one, and says what the player says.
(() => {
  const channel = window.CdpSpotifyHost;
  const send = (m) => channel.postMessage(JSON.stringify(m));
  const plain = (x) => { try { return x == null ? null : JSON.parse(JSON.stringify(x)); } catch { return null; } };
  const EVENTS = ['ready', 'not_ready', 'initialization_error', 'authentication_error', 'account_error', 'playback_error', 'player_state_changed', 'autoplay_failed'];
  const METHODS = ['connect', 'disconnect', 'resume', 'pause', 'togglePlay', 'seek', 'setVolume', 'getVolume', 'getCurrentState', 'nextTrack', 'previousTrack', 'activateElement'];
  const tokens = new Map();
  let player = null, nextToken = 1;

  window.onSpotifyWebPlaybackSDKReady = () => send({ type: 'sdk' });

  channel.onmessage = async (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.op === 'create') {
      if (player) player.disconnect();
      player = new window.Spotify.Player({
        name: String(m.name || 'CDPlayer'), volume: Number(m.volume) || 0.5,
        getOAuthToken: (cb) => { const id = nextToken++; tokens.set(id, cb); send({ type: 'token', id }); },
      });
      for (const event of EVENTS) player.addListener(event, (x) => send({ type: 'event', event, data: plain(x) }));
    } else if (m.op === 'token') {
      const cb = tokens.get(m.id);
      tokens.delete(m.id);
      if (cb) cb(String(m.token || ''));
    } else if (m.op === 'call') {
      if (!player || !METHODS.includes(m.method)) { send({ type: 'result', id: m.id, error: 'no player' }); return; }
      try { send({ type: 'result', id: m.id, value: plain(await player[m.method](...(Array.isArray(m.args) ? m.args : []))) }); }
      catch (err) { send({ type: 'result', id: m.id, error: String((err && err.message) || err) }); }
    }
  };
  send({ type: 'hello' });
})();
