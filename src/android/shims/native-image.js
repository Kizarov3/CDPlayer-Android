// Electron's nativeImage, as the main-process code uses it (covers: size, shrink, JPEG/PNG), over CdpNativeImage
// (NativeImage.java, synchronous as Electron's is). An image is its source — a file path or bytes — plus the size it
// has been resized to; nothing is decoded until it's encoded.

const bridge = () => globalThis.CdpNativeImage;

class NativeImage {
  constructor(src, size) { this._src = src; this._size = size; }
  static from(src) {
    const s = src && bridge() ? bridge().size(src.path || '', src.data || '') : '';
    return new NativeImage(s ? src : null, s ? JSON.parse(s) : null);
  }
  isEmpty() { return !this._size; }
  getSize() { return this._size ? { ...this._size } : { width: 0, height: 0 }; }
  getAspectRatio() { return this._size ? this._size.width / this._size.height : 1; }
  resize({ width, height } = {}) {
    if (!this._size) return this;
    const r = this._size.width / this._size.height;
    const w = Math.max(1, Math.round(width || height * r)), h = Math.max(1, Math.round(height || width / r));
    return new NativeImage(this._src, { width: w, height: h });
  }
  _encode(quality) {
    if (!this._size) return Buffer.alloc(0);
    const b64 = bridge().encode(this._src.path || '', this._src.data || '', this._size.width, this._size.height, quality);
    return Buffer.from(b64 || '', 'base64');
  }
  toJPEG(quality) { return this._encode(quality || 90); }
  toPNG() { return this._encode(-1); }
  toDataURL() { return `data:image/png;base64,${this.toPNG().toString('base64')}`; }
  toBitmap() { throw new Error('nativeImage.toBitmap: not on Android'); }
}

const fromBytes = (buf) => NativeImage.from(buf && buf.length ? { data: Buffer.from(buf).toString('base64') } : null);
module.exports = {
  NativeImage,
  createEmpty: () => new NativeImage(null, null),
  createFromBuffer: fromBytes,
  createFromPath: (p) => NativeImage.from(p ? { path: String(p) } : null),
  createFromDataURL: (url) => { const m = /^data:[^,]*?;base64,(.*)$/s.exec(String(url || '')); return NativeImage.from(m ? { data: m[1] } : null); },
};
