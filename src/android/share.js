// What the page makes to send somewhere — a NOW PLAYING card, a SHELFIE, THE YEAR's card, a video — on a phone: COPY
// opens Android's share sheet, SAVE puts it in the gallery (Pictures/CDPlayer, Movies/CDPlayer), with no dialog.
// The bytes go into <data>/exports first (one file at a time: the last one's left for the app it was shared to, and
// cleared at the next).

const safeName = (name, fallback) => String(name || fallback).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || fallback;

function createSharing({ fs, dataDir, phone }) {
  const dir = `${dataDir}/exports`;
  const put = (bytes, name) => {
    fs.mkdirSync(dir, { recursive: true });
    for (const old of fs.readdirSync(dir)) { try { fs.unlinkSync(`${dir}/${old}`); } catch { /* still being read */ } }
    const file = `${dir}/${name}`;
    fs.writeFileSync(file, Buffer.from(bytes));
    return file;
  };
  const save = async (bytes, name, mime) => {
    try { await phone.saveToGallery({ path: put(bytes, name), mime, name }); return true; } catch { return false; }
  };
  return {
    // (cdp.copyImage's place: there's no picture clipboard to paste from on a phone, its share sheet is the way)
    copyImage: (png) => phone.share({ path: put(png, 'CDPlayer.png'), mime: 'image/png' }),
    saveCard: (png, name) => save(png, `${safeName(name, 'Now Playing')}.png`, 'image/png'),
    saveVideo: (bytes, name, ext) => { const kind = ext === 'webm' ? 'webm' : 'mp4'; return save(bytes, `${safeName(name, 'Now Playing')}.${kind}`, `video/${kind}`); },
  };
}

module.exports = { createSharing, safeName };
