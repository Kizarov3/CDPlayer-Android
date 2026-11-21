package com.kizarov3.cdplayer;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.ByteArrayOutputStream;
import org.json.JSONObject;

/**
 * Pictures for the electron shim's nativeImage (src/android/shims/native-image.js), synchronously as Electron's are:
 * the size of a picture, and a picture scaled and encoded again (covers shrunk for the shelf and for IPC). Exposed as
 * `CdpNativeImage`. A source is a file path (`path`) or base64 bytes (`data`); answers are strings, "" when the
 * picture can't be read.
 */
public class NativeImage {
    private final String filesDir;

    NativeImage(android.content.Context context) { filesDir = NativeFs.canonicalFilesDir(context); }

    /** A file only where NativeFs may read (the app's own files, shared storage). */
    private String checked(String path) throws java.io.IOException {
        return path == null || path.isEmpty() ? null : NativeFs.allowed(path, filesDir).getPath();
    }

    private static Bitmap decode(String path, String data, int sample) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inSampleSize = sample;
        if (path != null && !path.isEmpty()) return BitmapFactory.decodeFile(path, o);
        byte[] b = Base64.decode(data, Base64.DEFAULT);
        return BitmapFactory.decodeByteArray(b, 0, b.length, o);
    }

    private static int[] bounds(String path, String data) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        if (path != null && !path.isEmpty()) BitmapFactory.decodeFile(path, o);
        else { byte[] b = Base64.decode(data, Base64.DEFAULT); BitmapFactory.decodeByteArray(b, 0, b.length, o); }
        return new int[] { o.outWidth, o.outHeight };
    }

    /** {"width","height"}, or "" */
    @JavascriptInterface public String size(String path, String data) {
        try {
            path = checked(path);
            int[] wh = bounds(path, data);
            if (wh[0] <= 0 || wh[1] <= 0) return "";
            return new JSONObject().put("width", wh[0]).put("height", wh[1]).toString();
        } catch (Throwable e) { return ""; }
    }

    /**
     * The picture at width × height (0: as it is), as base64 JPEG (quality 1–100) or PNG (quality < 0). Decoded at
     * the smallest power-of-two sample that still covers the size asked for, so a 3000 px cover never sits whole in memory.
     */
    @JavascriptInterface public String encode(String path, String data, int width, int height, int quality) {
        try {
            path = checked(path);
            int[] wh = bounds(path, data);
            if (wh[0] <= 0 || wh[1] <= 0) return "";
            int w = width > 0 ? width : wh[0], h = height > 0 ? height : wh[1];
            int sample = 1;
            while (wh[0] / (sample * 2) >= w && wh[1] / (sample * 2) >= h) sample *= 2;
            Bitmap bmp = decode(path, data, sample);
            if (bmp == null) return "";
            if (bmp.getWidth() != w || bmp.getHeight() != h) {
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, w, h, true);
                if (scaled != bmp) bmp.recycle();
                bmp = scaled;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(quality < 0 ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, quality < 0 ? 100 : Math.max(1, Math.min(100, quality)), out);
            bmp.recycle();
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable e) { return ""; }
    }
}
