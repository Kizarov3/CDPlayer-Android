// The main-process code's own fetch and globalThis.fetch (scrobble.js, similar-artists.js, http.js before "ready"), injected by the build
// for the bare `fetch` in the main bundle: through the app's native HTTP as Electron's net.fetch is — the WebView's
// fetch is a page's, which last.fm's and ListenBrainz's APIs refuse across origins (CORS).
export const fetch = (input, init) => require('./electron.js').net.fetch(input, init);
// (`globalThis.fetch` is defined as this one: as `fetch` it'd be the parameter itself in `{ fetch = globalThis.fetch }`)
export const __nativeFetch = fetch;
