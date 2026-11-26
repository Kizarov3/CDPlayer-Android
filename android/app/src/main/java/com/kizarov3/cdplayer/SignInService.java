package com.kizarov3.cdplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps CDPlayer awake while Spotify's sign-in page is open in the browser (PhonePlugin.spotifySignIn). In the
 * background with nothing playing, Android freezes the app within seconds (the cached-apps freezer; Samsung's sooner
 * still): the browser's redirect back to 127.0.0.1:8080 then reaches a socket nobody answers — the page loads and loads
 * after "Agree", then fails. A foreground service isn't frozen. "Short" (Android 14+): it is for a few minutes at most,
 * as long as the sign-in waits, and needs no permission of its own; a notification says what it's waiting for.
 */
public class SignInService extends Service {
    private static final String CHANNEL = "signin";
    private static final int NOTIFICATION_ID = 7;

    static void start(Context context) {
        try { ContextCompat.startForegroundService(context, new Intent(context, SignInService.class)); }
        catch (RuntimeException e) { /* not let start (in the background): the sign-in still tries */ }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, SignInService.class));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.signin_channel), NotificationManager.IMPORTANCE_LOW));
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_disc)
            .setContentTitle(getString(R.string.signin_title))
            .setContentText(getString(R.string.signin_text))
            .setOngoing(true)
            .setSilent(true)
            .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) ServiceCompat.startForeground(this, NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
            else startForeground(NOTIFICATION_ID, n);
        } catch (RuntimeException e) { stopSelf(); }
        return START_NOT_STICKY;
    }

    // (a short service's few minutes are up: the sign-in has given up by then too)
    @Override public void onTimeout(int startId, int fgsType) { stopSelf(); }

    @Override public IBinder onBind(Intent intent) { return null; }
}
