package com.kizarov3.cdplayer;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.util.Rational;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.media.session.MediaButtonReceiver;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {
    static MainActivity instance;
    /** MINI MODE (Phone.setMiniMode): leaving the app while it plays shrinks it into a small window over the others. */
    static boolean miniMode;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        instance = this;
        registerPlugin(PlaybackPlugin.class);
        registerPlugin(PhonePlugin.class);
        registerPlugin(StreamsPlugin.class);
        registerPlugin(SpotifyHostPlugin.class);
        super.onCreate(savedInstanceState);
        StreamBridge.install(bridge); // (a streamed song's sound for the player: /_cdpstream_/)
        ((android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(UpdateReceiver.NOTIFICATION); // (opened: the update's "tap to open" is done)
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

    // ---- MINI MODE: picture-in-picture, the cover and the song's name, with ⏮ ⏯ ⏭ ----

    private RemoteAction pipAction(int icon, String title, long action) {
        PendingIntent intent = MediaButtonReceiver.buildMediaButtonPendingIntent(this, action);
        return new RemoteAction(Icon.createWithResource(this, icon), title, title, intent);
    }

    PictureInPictureParams pipParams() {
        boolean playing = PlaybackService.now.playing;
        List<RemoteAction> actions = new ArrayList<>();
        actions.add(pipAction(android.R.drawable.ic_media_previous, "Previous", PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS));
        actions.add(playing ? pipAction(android.R.drawable.ic_media_pause, "Pause", PlaybackStateCompat.ACTION_PAUSE)
            : pipAction(android.R.drawable.ic_media_play, "Play", PlaybackStateCompat.ACTION_PLAY));
        actions.add(pipAction(android.R.drawable.ic_media_next, "Next", PlaybackStateCompat.ACTION_SKIP_TO_NEXT));
        PictureInPictureParams.Builder b = new PictureInPictureParams.Builder().setAspectRatio(new Rational(1, 1)).setActions(actions);
        if (Build.VERSION.SDK_INT >= 31) b.setAutoEnterEnabled(miniMode && playing).setSeamlessResizeEnabled(false);
        return b.build();
    }

    /** The window's buttons and whether it goes small by itself brought up to date (playing, paused, MINI MODE). */
    static void refreshPip() {
        MainActivity a = instance;
        if (a == null) return;
        a.runOnUiThread(() -> { try { a.setPictureInPictureParams(a.pipParams()); } catch (RuntimeException ignored) { } });
    }

    /** Into the small window now (MINI MODE from the search). */
    static boolean enterPip() {
        MainActivity a = instance;
        if (a == null) return false;
        a.runOnUiThread(() -> { try { a.enterPictureInPictureMode(a.pipParams()); } catch (RuntimeException ignored) { } });
        return true;
    }

    // (before Android 12 there's no going small by itself: Home or the recents button does it here)
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT < 31 && miniMode && PlaybackService.now.playing) {
            try { enterPictureInPictureMode(pipParams()); } catch (RuntimeException ignored) { }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPip, newConfig);
        tellPage(inPip ? "cdp-pip-on" : "cdp-pip-off");
    }

    // A keyboard plugged in or taken away (keyboard|keyboardHidden are in the manifest's configChanges): KEYBOARD SHORTCUTS
    // shown or not (src/android/boot.entry.js).
    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        tellPage(c.keyboard == Configuration.KEYBOARD_QWERTY ? "cdp-keyboard-on" : "cdp-keyboard-off");
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    // (a plain DOM event, so it's harmless before the page — or Capacitor's script — has loaded)
    private void tellPage(String event) {
        if (bridge != null && bridge.getWebView() != null) bridge.getWebView().evaluateJavascript("document.dispatchEvent(new Event('" + event + "'))", null);
    }
}
