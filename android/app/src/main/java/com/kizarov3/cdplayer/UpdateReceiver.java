package com.kizarov3.cdplayer;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * The update's way through (PhonePlugin.installUpdate, a PackageInstaller session — as the desktop's RESTART TO UPDATE):
 * the session's answers (Android's "Update?" when it wants it, or why it failed), and once the new version is in,
 * CDPlayer opened again — or, where Android won't let an app in the background open itself, a notification to.
 */
public class UpdateReceiver extends BroadcastReceiver {
    static final String STATUS = "com.kizarov3.cdplayer.UPDATE_STATUS";
    static final int NOTIFICATION = 7;

    @Override public void onReceive(Context context, Intent intent) {
        if (STATUS.equals(intent.getAction())) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                // (the receiver isn't exported, so only Android's own session sends this; still, only the system's installer
                // is opened, and with no right to any of CDPlayer's files)
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm == null) return;
                android.content.ComponentName c = confirm.resolveActivity(context.getPackageManager());
                if (c == null) return;
                try {
                    if ((context.getPackageManager().getApplicationInfo(c.getPackageName(), 0).flags & android.content.pm.ApplicationInfo.FLAG_SYSTEM) == 0) return;
                } catch (PackageManager.NameNotFoundException e) { return; }
                confirm.removeFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                String why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                PhonePlugin.updateFailed(status == PackageInstaller.STATUS_FAILURE_ABORTED ? "cancelled" : why != null ? why : "failed");
            }
        } else if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if (open == null) return;
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { context.startActivity(open); } catch (RuntimeException ignored) { }
            // (shown only if it didn't open: MainActivity takes it away as it starts)
            if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26) nm.createNotificationChannel(new NotificationChannel("updates", "Updates", NotificationManager.IMPORTANCE_DEFAULT));
            String version = "";
            try { version = " " + context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; } catch (PackageManager.NameNotFoundException ignored) { }
            nm.notify(NOTIFICATION, new NotificationCompat.Builder(context, "updates")
                .setSmallIcon(R.drawable.ic_stat_disc)
                .setContentTitle("CDPlayer" + version + " is installed")
                .setContentText("Tap to open it")
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
                .build());
        }
    }
}
