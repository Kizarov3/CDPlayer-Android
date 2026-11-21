package com.kizarov3.cdplayer;

import android.content.Context;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Files for the desktop's main-process code running in the page (src/android/shims/fs.js), synchronously — as Node's
 * fs is, and as store.js, shelf.js and the rest use it. Exposed as `CdpNativeFs`; every method answers a string:
 * the result, or JSON `{"error": "<Node error code>"}`. Only the app's own files and shared storage (/storage/...)
 * are reachable.
 */
public class NativeFs {
    private final String dataDir;
    private final String filesDir;

    NativeFs(Context context) {
        filesDir = canonicalFilesDir(context); // (canonical: /data/user/0 is a link to /data/data on many phones)
        dataDir = filesDir + "/cdplayer";
        new File(dataDir).mkdirs();
    }

    private File allowed(String path) throws IOException { return allowed(path, filesDir); }

    /** `path`, if it's the app's own files or shared storage — nothing else of the phone's is reachable from the page. */
    static File allowed(String path, String filesDir) throws IOException {
        if (path == null || path.isEmpty()) throw new FsError("EINVAL");
        File f = new File(path);
        String canon = f.getCanonicalPath();
        if (!(canon.equals(filesDir) || canon.startsWith(filesDir + "/") || canon.startsWith("/storage/") || canon.startsWith("/sdcard/"))) throw new FsError("EACCES");
        return f;
    }

    static String canonicalFilesDir(Context context) {
        try { return context.getFilesDir().getCanonicalPath(); } catch (IOException e) { return context.getFilesDir().getAbsolutePath(); }
    }

    static final class FsError extends IOException { FsError(String code) { super(code); } }

    private static String error(Exception e) {
        String code = e instanceof FsError ? e.getMessage() : e instanceof java.io.FileNotFoundException ? "ENOENT" : "EIO";
        try { return new JSONObject().put("error", code).put("message", String.valueOf(e.getMessage())).toString(); } catch (Exception x) { return "{\"error\":\"EIO\"}"; }
    }

    @JavascriptInterface public String dataDir() { return dataDir; }

    @JavascriptInterface public String stat(String path) {
        try {
            File f = allowed(path);
            if (!f.exists()) throw new FsError("ENOENT");
            return new JSONObject().put("size", f.length()).put("mtimeMs", f.lastModified()).put("isDir", f.isDirectory()).toString();
        } catch (Exception e) { return error(e); }
    }

    /** [[name, isDir], ...] */
    @JavascriptInterface public String readdir(String path) {
        try {
            File f = allowed(path);
            if (!f.exists()) throw new FsError("ENOENT");
            if (!f.isDirectory()) throw new FsError("ENOTDIR");
            File[] list = f.listFiles();
            JSONArray out = new JSONArray();
            if (list != null) for (File c : list) out.put(new JSONArray().put(c.getName()).put(c.isDirectory()));
            return out.toString();
        } catch (Exception e) { return error(e); }
    }

    /** `length` bytes from `offset` (length < 0: to the end), base64. */
    @JavascriptInterface public String read(String path, double offset, double length) {
        try {
            File f = allowed(path);
            if (!f.exists()) throw new FsError("ENOENT");
            if (f.isDirectory()) throw new FsError("EISDIR");
            try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
                long size = raf.length(), from = Math.min((long) offset, size);
                long n = length < 0 ? size - from : Math.min((long) length, size - from);
                byte[] buf = new byte[(int) n];
                raf.seek(from);
                raf.readFully(buf);
                return Base64.encodeToString(buf, Base64.NO_WRAP);
            }
        } catch (Exception e) { return error(e); }
    }

    /** Writes base64 data; not appending, through a temp file and a rename, so a killed app never leaves half a file. */
    @JavascriptInterface public String write(String path, String base64, boolean append) {
        try {
            File f = allowed(path);
            byte[] data = Base64.decode(base64, Base64.DEFAULT);
            if (append) {
                try (FileOutputStream out = new FileOutputStream(f, true)) { out.write(data); }
            } else {
                File tmp = new File(f.getPath() + ".tmp-cdp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data); out.getFD().sync(); }
                if (!tmp.renameTo(f)) { tmp.delete(); throw new FsError("EIO"); }
            }
            return "";
        } catch (Exception e) { return error(e); }
    }

    @JavascriptInterface public String mkdirs(String path) {
        try { File f = allowed(path); if (!f.isDirectory() && !f.mkdirs()) throw new FsError("EIO"); return ""; } catch (Exception e) { return error(e); }
    }

    @JavascriptInterface public String remove(String path, boolean recursive) {
        try {
            File f = allowed(path);
            if (!f.exists()) throw new FsError("ENOENT");
            if (f.isDirectory() && !recursive && f.list() != null && f.list().length > 0) throw new FsError("ENOTEMPTY");
            delete(f);
            return "";
        } catch (Exception e) { return error(e); }
    }

    private static void delete(File f) throws IOException {
        File[] kids = f.isDirectory() ? f.listFiles() : null;
        if (kids != null) for (File k : kids) delete(k);
        if (!f.delete()) throw new FsError("EIO");
    }

    @JavascriptInterface public String rename(String from, String to) {
        try {
            File a = allowed(from), b = allowed(to);
            if (!a.exists()) throw new FsError("ENOENT");
            if (b.exists() && !b.isDirectory()) b.delete();
            if (!a.renameTo(b)) throw new FsError("EIO");
            return "";
        } catch (Exception e) { return error(e); }
    }

    @JavascriptInterface public String realpath(String path) {
        try { File f = allowed(path); if (!f.exists()) throw new FsError("ENOENT"); return new JSONObject().put("path", f.getCanonicalPath()).toString(); } catch (Exception e) { return error(e); }
    }

    /** The room left where `path` is (fs.statfs's place, for TAKE ALONG). → { bavail, bsize } */
    @JavascriptInterface public String statfs(String path) {
        try { File f = allowed(path); return new JSONObject().put("bavail", f.getUsableSpace()).put("bsize", 1).toString(); } catch (Exception e) { return error(e); }
    }
}
