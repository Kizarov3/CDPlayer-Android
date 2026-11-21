// The app's own files the main-process code reads from disk (its locales), served from the bundle under /app
// (src/android/shims/fs.js). Filled in by scripts/build-android.mjs.
module.exports = globalThis.__CDP_BUNDLED_FILES__ || {};
