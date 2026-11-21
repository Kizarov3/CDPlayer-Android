package com.kizarov3.cdplayer;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlaybackPlugin.class);
        registerPlugin(PhonePlugin.class);
        super.onCreate(savedInstanceState);
        // (added before the first page has committed, so they're there when android.js runs. They answer every frame
        // of the page: the page's CSP lets in nothing but the app's own files — scripts/build-android.mjs — and
        // Capacitor sends any other address to the browser.)
        bridge.getWebView().addJavascriptInterface(new NativeFs(this), "CdpNativeFs");
        bridge.getWebView().addJavascriptInterface(new NativeImage(this), "CdpNativeImage");
        askForMusic();
        // Back: the page closes what's open on top, or sends the app to the background (src/android/ui/phone-ui.js,
        // app.js) — it never ends the app, so the music never stops for it.
        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { tellPage("cdp-back"); }
        });
    }

    private static final int ASK_MUSIC = 7301;

    /** The phone's music (and its cover pictures, and a notification to play from), asked for on start until given. */
    private void askForMusic() {
        List<String> want = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            want.add(Manifest.permission.READ_MEDIA_AUDIO);
            want.add(Manifest.permission.READ_MEDIA_IMAGES);
            want.add(Manifest.permission.POST_NOTIFICATIONS);
        } else {
            want.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        List<String> missing = new ArrayList<>();
        for (String p : want) if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), ASK_MUSIC);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != ASK_MUSIC) return;
        for (int i = 0; i < permissions.length; i++) {
            boolean music = permissions[i].equals(Manifest.permission.READ_MEDIA_AUDIO) || permissions[i].equals(Manifest.permission.READ_EXTERNAL_STORAGE);
            // The music just let in: the page starts again, so the shelf is read with it.
            if (music && results[i] == PackageManager.PERMISSION_GRANTED && bridge != null) { bridge.getWebView().reload(); return; }
        }
    }

    // The app going to the background and back, for the page (src/android/boot.entry.js).
    @Override
    public void onPause() {
        super.onPause();
        tellPage("cdp-pause");
    }

    @Override
    public void onResume() {
        super.onResume();
        tellPage("cdp-resume");
    }

    // (a plain DOM event, so it's harmless before the page — or Capacitor's script — has loaded)
    private void tellPage(String event) {
        if (bridge != null && bridge.getWebView() != null) bridge.getWebView().evaluateJavascript("document.dispatchEvent(new Event('" + event + "'))", null);
    }
}
