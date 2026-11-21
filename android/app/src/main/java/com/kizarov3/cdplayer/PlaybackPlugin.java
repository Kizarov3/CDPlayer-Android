package com.kizarov3.cdplayer;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The page's side of {@link PlaybackService}: `Playback.update({ title, artist, album, cover, playing, position,
 * duration })` (cover: a data URL; position/duration in seconds) starts the service or refreshes it, `stop()` ends it,
 * and the `command` event ({ action: play|pause|next|previous|seek, position }) carries the notification's, lock
 * screen's and headset's buttons back.
 */
@CapacitorPlugin(name = "Playback")
public class PlaybackPlugin extends Plugin {
    private String coverKey;

    @Override public void load() {
        PlaybackService.commands = (action, positionMs) -> {
            JSObject data = new JSObject();
            data.put("action", action);
            data.put("position", positionMs / 1000.0);
            notifyListeners("command", data, true);
        };
    }

    @PluginMethod public void update(PluginCall call) {
        PlaybackService.NowPlaying now = PlaybackService.now;
        now.title = call.getString("title", now.title);
        now.artist = call.getString("artist", now.artist);
        now.album = call.getString("album", now.album);
        now.playing = call.getBoolean("playing", now.playing);
        Double pos = call.getDouble("position"), dur = call.getDouble("duration");
        if (pos != null) now.positionMs = Math.round(pos * 1000);
        if (dur != null) now.durationMs = Math.round(dur * 1000);
        String cover = call.getString("cover");
        if (cover != null && !cover.equals(coverKey)) { coverKey = cover; now.cover = decode(cover); }

        PlaybackService s = PlaybackService.instance;
        if (s != null) PlaybackService.refreshSoon();
        else if (now.playing) ContextCompat.startForegroundService(getContext(), new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    @PluginMethod public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }

    private static Bitmap decode(String dataUrl) {
        try {
            int comma = dataUrl.indexOf(',');
            byte[] bytes = Base64.decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
