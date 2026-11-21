package com.kizarov3.cdplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;

/**
 * Keeps CDPlayer alive while it plays (the sound itself is the WebView's Web Audio): a foreground service with a
 * MediaSession, so the media notification, the lock screen and headset/Bluetooth buttons control the player, and
 * "headphones unplugged". Audio focus is the WebView's own: it pauses its media for calls and other players (a
 * focus request here would take the focus from the WebView and pause the page). Commands go back to the page through
 * {@link PlaybackPlugin}.
 */
public class PlaybackService extends Service {
    static final String CHANNEL = "playback";
    static final int NOTIFICATION_ID = 1;

    /** What the page shows now; set by the plugin before it starts or updates the service. */
    static class NowPlaying {
        String title = "", artist = "", album = "";
        Bitmap cover;
        boolean playing;
        long positionMs, durationMs;
    }

    interface Commands { void send(String action, long positionMs); }

    static volatile PlaybackService instance;
    static volatile Commands commands;
    static final NowPlaying now = new NowPlaying();

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private boolean noisyRegistered;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(i.getAction())) send("pause", 0);
        }
    };

    static void send(String action, long positionMs) {
        Commands c = commands;
        if (c != null) c.send(action, positionMs);
    }

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);

        session = new MediaSessionCompat(this, "CDPlayer");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { send("play", 0); }
            @Override public void onPause() { send("pause", 0); }
            @Override public void onSkipToNext() { send("next", 0); }
            @Override public void onSkipToPrevious() { send("previous", 0); }
            @Override public void onStop() { send("pause", 0); }
            @Override public void onSeekTo(long pos) { send("seek", pos); }
        });
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CDPlayer:playback");
        wakeLock.setReferenceCounted(false);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        MediaButtonReceiver.handleIntent(session, intent);
        refresh();
        return START_NOT_STICKY;
    }

    /** Puts {@link #now} on the session, the notification and the wake lock. */
    void refresh() {
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, now.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, now.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, now.album)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, now.durationMs);
        if (now.cover != null) meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, now.cover);
        session.setMetadata(meta.build());
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_SEEK_TO)
            .setState(now.playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, now.positionMs, now.playing ? 1f : 0f)
            .build());

        Notification n = buildNotification();
        // Android 12+ refuses to make a service foreground from the background, so it stays foreground through a pause
        // (a play from the lock screen or a headset then just carries on) and is only let go after a long one.
        handler.removeCallbacks(letGo);
        if (now.playing || foreground) {
            try {
                ServiceCompat.startForeground(this, NOTIFICATION_ID, n,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0);
                foreground = true;
            } catch (RuntimeException e) { // ForegroundServiceStartNotAllowedException (API 31+): show it all the same
                getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
            }
        } else {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
        }

        if (now.playing) {
            if (!wakeLock.isHeld()) wakeLock.acquire();
            if (!noisyRegistered) { registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)); noisyRegistered = true; }
        } else {
            if (wakeLock.isHeld()) wakeLock.release();
            if (noisyRegistered) { unregisterReceiver(noisy); noisyRegistered = false; }
            if (foreground) handler.postDelayed(letGo, LET_GO_AFTER_MS);
        }
    }

    /** Paused this long: no longer foreground; the notification stays, swipeable, so the music can still be resumed. */
    static final long LET_GO_AFTER_MS = 10 * 60 * 1000;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private boolean foreground;
    private final Runnable letGo = () -> {
        if (now.playing) return;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
        foreground = false;
    };

    /** {@link #refresh()} on the main thread (the plugin's calls come on Capacitor's plugin thread). */
    static void refreshSoon() {
        PlaybackService s = instance;
        if (s != null) s.handler.post(s::refresh);
    }

    private NotificationCompat.Action action(int icon, String title, long action) {
        return new NotificationCompat.Action(icon, title, MediaButtonReceiver.buildMediaButtonPendingIntent(this, action));
    }

    private Notification buildNotification() {
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(now.title)
            .setContentText(now.artist)
            .setLargeIcon(now.cover)
            .setContentIntent(session.getController().getSessionActivity())
            .setDeleteIntent(MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_STOP))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(now.playing)
            .addAction(action(android.R.drawable.ic_media_previous, "Previous", PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS))
            .addAction(now.playing
                ? action(android.R.drawable.ic_media_pause, "Pause", PlaybackStateCompat.ACTION_PAUSE)
                : action(android.R.drawable.ic_media_play, "Play", PlaybackStateCompat.ACTION_PLAY))
            .addAction(action(android.R.drawable.ic_media_next, "Next", PlaybackStateCompat.ACTION_SKIP_TO_NEXT))
            .setStyle(new MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
            .build();
    }

    @Override public void onDestroy() {
        instance = null;
        handler.removeCallbacks(letGo);
        if (wakeLock.isHeld()) wakeLock.release();
        if (noisyRegistered) unregisterReceiver(noisy);
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
