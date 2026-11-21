// The desktop's encoders/take-along-worker.js as a Web Worker for Android (TAKE ALONG's MP3 320): the same pcm.js and
// mp3.js, the song read by its address in the app (Capacitor's file server: { url, stamp }) instead of by its path.
// The last song read is kept, decoded, for the next track cut from it (a cue sheet's).
globalThis.Buffer = require('buffer').Buffer;
const { readAudio, toCdAudio } = require('../main/encoders/pcm');
const { encodeMp3 } = require('../main/encoders/mp3');

let last = null; // { url, stamp, audio }

async function convert({ url, stamp, kind, from, to }) {
  if (!last || last.url !== url || last.stamp !== stamp) {
    last = null; // (the one before let go first: an album-length file is hundreds of MB)
    const r = await fetch(url);
    if (!r.ok) throw new Error(`couldn't read the song (${r.status})`);
    last = { url, stamp, audio: readAudio(kind, Buffer.from(await r.arrayBuffer())) };
  }
  const pcm = toCdAudio(last.audio, { from, to });
  if (pcm.length < 2) throw new Error('no audio in the file');
  return encodeMp3(pcm);
}

let queue = Promise.resolve(); // (one at a time, in the order asked)
self.onmessage = ({ data: job }) => {
  queue = queue.then(async () => {
    try {
      const file = await convert(job);
      const out = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      self.postMessage({ id: job.id, file: out }, [out]);
    } catch (e) {
      self.postMessage({ id: job.id, error: String(e.message || e) });
    }
  });
};
