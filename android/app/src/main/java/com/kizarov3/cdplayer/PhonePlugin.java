package com.kizarov3.cdplayer;

import android.app.Activity;
import android.app.AlertDialog;
import android.database.Cursor;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.view.PixelCopy;
import android.view.View;
import android.provider.MediaStore;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * The phone round the page: `Phone.setBars({ color: '#rrggbb', light })` — the status and navigation bars in the theme's
 * colour; `share` and `saveToGallery` — a card, a SHELFIE or a video the page made (written into exports/ first).
 */
@CapacitorPlugin(name = "Phone")
public class PhonePlugin extends Plugin {
    /** The app to the background, as Home would — playback goes on (Android's back with nothing left to close). */
    @PluginMethod public void background(PluginCall call) {
        getActivity().runOnUiThread(() -> { getActivity().moveTaskToBack(true); call.resolve(); });
    }

    /** A web page in the phone's browser (`{ url }`, http or https only): last.fm's sign-in, Discogs, a token page. */
    @PluginMethod public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.matches("(?i)https?://.+")) { call.reject("not a web page"); return; }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(view);
            call.resolve();
        } catch (Exception e) { call.reject("no browser"); }
    }

    /** Whether the songs' own files can be changed (TAGS, SAVE FOUND ART & LYRICS) → `{ allowed }`. */
    @PluginMethod public void canChangeFiles(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? Environment.isExternalStorageManager()
            : ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED);
        call.resolve(r);
    }

    /** Asks for it: Android 11+'s All files access page for CDPlayer (a switch there), Android 10's permission dialog. */
    @PluginMethod public void askToChangeFiles(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Intent page = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + activity.getPackageName()));
                    try { activity.startActivity(page); }
                    catch (Exception e) { activity.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
                } else {
                    ActivityCompat.requestPermissions(activity, new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 7301);
                }
                call.resolve();
            } catch (Exception e) { call.reject("can't ask"); }
        });
    }

    // ---- Files the user picks (dialog.showOpenDialog / showSaveDialog in shims/electron.js) ----------------------------

    /** The system's file picker → `{ paths }`: each picked file copied into files/picked/ (emptied first), so the
     *  desktop's code reads it by its path as it would a file the desktop's dialog gave it. `{ multiple }`. */
    @PluginMethod public void pickFiles(PluginCall call) {
        Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("*/*");
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, call.getBoolean("multiple", false));
        startActivityForResult(call, pick, "picked");
    }

    @ActivityCallback private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        List<Uri> uris = new ArrayList<>();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) uris.add(data.getData());
        }
        new Thread(() -> { // (a big export of plays takes a while to copy: not on the UI's thread)
            JSArray paths = new JSArray();
            try {
                File dir = new File(getContext().getFilesDir(), "picked");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                dir.mkdirs();
                ContentResolver resolver = getContext().getContentResolver();
                for (int i = 0; i < uris.size(); i++) {
                    String name = nameOf(uris.get(i)).replaceAll("[\\\\/:*?\"<>|]", "_");
                    File to = new File(dir, uris.size() > 1 ? i + "-" + name : name);
                    try (InputStream in = resolver.openInputStream(uris.get(i)); OutputStream out = new java.io.FileOutputStream(to)) { copy(in, out); }
                    paths.put(to.getAbsolutePath());
                }
                JSObject r = new JSObject();
                r.put("paths", paths);
                call.resolve(r);
            } catch (Exception e) { call.reject("couldn't read the file"); }
        }).start();
    }

    private String nameOf(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Exception ignored) { /* no name: the last part of its address */ }
        String last = uri.getLastPathSegment();
        return last != null ? last : "file";
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[256 * 1024];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
    }

    /** The system's "save as" → `{ uri }` (null when cancelled): where the user chose, `{ name, mime }` suggested. */
    /** The places the user chose in createFile and not yet written: writeToUri writes only to one of these, once — the
     *  page can't name any other (the app's own providers, say). */
    private final java.util.Set<String> chosen = java.util.Collections.synchronizedSet(new java.util.HashSet<>());

    @PluginMethod public void createFile(PluginCall call) {
        Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        create.addCategory(Intent.CATEGORY_OPENABLE);
        create.setType(call.getString("mime", "application/octet-stream"));
        create.putExtra(Intent.EXTRA_TITLE, call.getString("name", "CDPlayer"));
        startActivityForResult(call, create, "created");
    }

    @ActivityCallback private void created(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Intent data = result.getData();
        String uri = result.getResultCode() == Activity.RESULT_OK && data != null && data.getData() != null ? data.getData().toString() : null;
        if (uri != null) chosen.add(uri);
        r.put("uri", uri);
        call.resolve(r);
    }

    /** `{ path, uri }`: the file the desktop's code wrote (files/saving/) into where the user chose, then removed. */
    @PluginMethod public void writeToUri(PluginCall call) {
        String path = call.getString("path", ""), uri = call.getString("uri", "");
        if (!chosen.remove(uri)) { call.reject("not a place the user chose"); return; }
        new Thread(() -> {
            try {
                File from = new File(path);
                String saving = new File(getContext().getFilesDir(), "saving").getCanonicalPath();
                if (!from.getCanonicalPath().startsWith(saving + "/")) throw new IOException("not a file being saved");
                try (InputStream in = new FileInputStream(from); OutputStream out = getContext().getContentResolver().openOutputStream(Uri.parse(uri), "wt")) {
                    if (out == null) throw new IOException("no stream");
                    copy(in, out);
                }
                from.delete();
                call.resolve();
            } catch (Exception e) { call.reject("couldn't save the file"); }
        }).start();
    }

    /** A question (dialog.showMessageBox): `{ message, detail, buttons, cancelId }` → `{ response }` (the button's index;
     *  Back or a tap outside is cancelId). The first button is the yes, the last the no; a third goes in the middle. */
    @PluginMethod public void ask(PluginCall call) {
        Activity activity = getActivity();
        JSArray given = call.getArray("buttons", new JSArray());
        int cancelId = call.getInt("cancelId", given.length() - 1);
        activity.runOnUiThread(() -> {
            try {
                AlertDialog.Builder b = new AlertDialog.Builder(activity, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle(call.getString("message", ""));
                String detail = call.getString("detail", "");
                if (!detail.isEmpty()) b.setMessage(detail);
                final boolean[] answered = { false };
                java.util.function.IntConsumer answer = (i) -> { if (answered[0]) return; answered[0] = true; JSObject r = new JSObject(); r.put("response", i); call.resolve(r); };
                if (given.length() > 0) b.setPositiveButton(given.getString(0), (d, w) -> answer.accept(0));
                if (given.length() > 1) b.setNegativeButton(given.getString(given.length() - 1), (d, w) -> answer.accept(given.length() - 1));
                if (given.length() > 2) b.setNeutralButton(given.getString(1), (d, w) -> answer.accept(1));
                b.setOnCancelListener((d) -> answer.accept(cancelId));
                b.show();
            } catch (Exception e) { JSObject r = new JSObject(); r.put("response", cancelId); call.resolve(r); }
        });
    }

    @PluginMethod public void setBars(PluginCall call) {
        String color = call.getString("color", "#111113");
        boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            try {
                int c = Color.parseColor(color);
                a.getWindow().getDecorView().setBackgroundColor(c); // (what shows round the page, under the bars)
                a.getWindow().setStatusBarColor(c); // (Android 14 and older; edge-to-edge ones show the decor's)
                a.getWindow().setNavigationBarColor(c);
                WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView());
                bars.setAppearanceLightStatusBars(light);
                bars.setAppearanceLightNavigationBars(light);
            } catch (IllegalArgumentException e) { /* not a colour */ }
            call.resolve();
        });
    }

    /** A file the page put in exports/: what it may hand out, nothing else of the app's. null if it's elsewhere. */
    private File exported(PluginCall call) {
        try {
            File exports = new File(getContext().getFilesDir(), "cdplayer/exports").getCanonicalFile();
            File f = new File(call.getString("path", "")).getCanonicalFile();
            return f.isFile() && exports.equals(f.getParentFile()) ? f : null;
        } catch (IOException e) { return null; }
    }

    /** Android's share sheet with the file (to a chat, Stories, Drive…). */
    @PluginMethod public void share(PluginCall call) {
        File f = exported(call);
        if (f == null) { call.reject("not an export"); return; }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
        Intent send = new Intent(Intent.ACTION_SEND).setType(call.getString("mime", "image/png")).putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        send.setClipData(ClipData.newRawUri("", uri)); // (the picture shown in the sheet)
        getActivity().runOnUiThread(() -> { getActivity().startActivity(Intent.createChooser(send, null)); call.resolve(); });
    }

    /** Into the phone's Pictures/CDPlayer (a video: Movies/CDPlayer), where the gallery shows it. → { where } */
    @PluginMethod public void saveToGallery(PluginCall call) {
        File f = exported(call);
        if (f == null) { call.reject("not an export"); return; }
        String mime = call.getString("mime", "image/png"), name = call.getString("name", f.getName());
        boolean video = mime.startsWith("video/");
        String folder = (video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/CDPlayer";
        new Thread(() -> {
            ContentResolver r = getContext().getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, folder);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri into = r.insert(video ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (into == null) { call.reject("no room in the gallery"); return; }
            try (InputStream in = new FileInputStream(f); OutputStream out = r.openOutputStream(into)) {
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            } catch (IOException | NullPointerException e) { r.delete(into, null, null); call.reject("couldn't write it"); return; }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            r.update(into, v, null, null);
            JSObject ok = new JSObject();
            ok.put("where", folder);
            call.resolve(ok);
        }).start();
    }

    /**
     * A part of the page as it is on screen (webContents.capturePage's place, for SHELFIE): { x, y, width, height } in
     * the page's pixels, `scale` its devicePixelRatio. → { png } (base64), in the screen's pixels.
     */
    @PluginMethod public void capture(PluginCall call) {
        double scale = call.getDouble("scale", 1.0);
        Activity a = getActivity();
        a.runOnUiThread(() -> {
            View web = getBridge().getWebView();
            int[] at = new int[2];
            web.getLocationInWindow(at);
            int left = at[0] + (int) Math.round(call.getDouble("x", 0.0) * scale), top = at[1] + (int) Math.round(call.getDouble("y", 0.0) * scale);
            int w = (int) Math.round(call.getDouble("width", 0.0) * scale), h = (int) Math.round(call.getDouble("height", 0.0) * scale);
            Rect r = new Rect(Math.max(left, at[0]), Math.max(top, at[1]), Math.min(left + w, at[0] + web.getWidth()), Math.min(top + h, at[1] + web.getHeight()));
            if (r.width() <= 0 || r.height() <= 0) { call.reject("nothing there"); return; }
            Bitmap bitmap = Bitmap.createBitmap(r.width(), r.height(), Bitmap.Config.ARGB_8888);
            HandlerThread thread = new HandlerThread("capture");
            thread.start();
            PixelCopy.request(a.getWindow(), r, bitmap, (result) -> {
                if (result != PixelCopy.SUCCESS) { call.reject("couldn't copy the screen"); thread.quitSafely(); return; }
                ByteArrayOutputStream png = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
                bitmap.recycle();
                JSObject ok = new JSObject();
                ok.put("png", Base64.encodeToString(png.toByteArray(), Base64.NO_WRAP));
                call.resolve(ok);
                thread.quitSafely();
            }, new Handler(thread.getLooper()));
        });
    }
}
