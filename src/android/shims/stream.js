// Only loaded, never used on Android (the media protocol and the updater are desktop-only): enough for the
// `class X extends Transform` and `Readable.fromWeb` references made at load time.
class Stream { pipe() { throw new Error('stream: not on Android'); } on() { return this; } }
class Readable extends Stream { static from() { throw new Error('stream: not on Android'); } static fromWeb() { throw new Error('stream: not on Android'); } }
class Writable extends Stream {}
class Transform extends Stream {}
class PassThrough extends Transform {}
const pipeline = () => Promise.reject(new Error('stream: not on Android'));
module.exports = { Stream, Readable, Writable, Transform, PassThrough, pipeline, promises: { pipeline } };
