// src/android/media-session.js: what app.js tells navigator.mediaSession reaches the Playback plugin, and its buttons
// come back as app.js's action handlers.
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installMediaSession, MediaMetadata } = require('../src/android/media-session.js');

function fakePlayback() {
  const calls = [];
  let listener = null;
  return {
    calls,
    update: (o) => { calls.push(['update', o]); return Promise.resolve(); },
    stop: () => { calls.push(['stop']); return Promise.resolve(); },
    addListener: (ev, fn) => { assert.strictEqual(ev, 'command'); listener = fn; },
    press: (action, position) => listener({ action, position }),
  };
}

test('metadata, state and position reach the plugin; the cover only when it changes; nothing loaded stops it', () => {
  const pb = fakePlayback();
  const nav = {}, g = {};
  const ms = installMediaSession(pb, nav, g);
  assert.strictEqual(nav.mediaSession, ms);
  ms.metadata = new g.MediaMetadata({ title: 'Группа крови', artist: 'Кино', album: 'Группа крови', artwork: [{ src: 'data:image/jpeg;base64,AAAA' }] });
  ms.playbackState = 'playing';
  ms.setPositionState({ duration: 285, position: 12.5, playbackRate: 1 });
  const updates = pb.calls.filter((c) => c[0] === 'update').map((c) => c[1]);
  assert.deepStrictEqual(updates[0], { title: 'Группа крови', artist: 'Кино', album: 'Группа крови', playing: false, cover: 'data:image/jpeg;base64,AAAA' });
  assert.strictEqual(updates[1].playing, true);
  assert.strictEqual('cover' in updates[1], false);
  assert.deepStrictEqual([updates[2].position, updates[2].duration], [12.5, 285]);
  ms.playbackState = 'none';
  ms.metadata = null;
  assert.deepStrictEqual(pb.calls.at(-1), ['stop']);
  assert.throws(() => ms.setPositionState({ duration: 10, position: 11 }), TypeError);
  assert.ok(new MediaMetadata({ title: 'x' }).artwork.length === 0);
});

test('the notification\'s buttons call the action handlers app.js set', () => {
  const pb = fakePlayback();
  const ms = installMediaSession(pb, {}, {});
  const got = [];
  for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']) ms.setActionHandler(a, (e) => got.push(e));
  pb.press('play'); pb.press('pause'); pb.press('next'); pb.press('previous'); pb.press('seek', 42.5);
  assert.deepStrictEqual(got.map((e) => e.action), ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']);
  assert.strictEqual(got[4].seekTime, 42.5);
  ms.setActionHandler('play', null);
  pb.press('play');
  assert.strictEqual(got.length, 5);
});
