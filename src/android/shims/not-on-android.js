// worker_threads, net, http, https, zlib (for now): only desktop features use them (CDs, ripping, yt-dlp,
// the phone remote, Discord, updates). Their modules still load; calling into them fails plainly.
const no = (name) => () => { throw new Error(`${name}: not on Android`); };
const handler = { get: (_t, key) => (key === '__esModule' ? false : key === 'default' ? proxy : no(String(key))) };
const proxy = new Proxy({}, handler);
module.exports = proxy;
