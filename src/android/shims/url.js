const fileURLToPath = (u) => {
  const url = typeof u === 'string' ? new URL(u) : u;
  if (url.protocol !== 'file:') throw new TypeError('The URL must be of scheme file');
  return decodeURIComponent(url.pathname);
};
const pathToFileURL = (p) => new URL(`file://${encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')}`);
module.exports = { URL, URLSearchParams, fileURLToPath, pathToFileURL };
