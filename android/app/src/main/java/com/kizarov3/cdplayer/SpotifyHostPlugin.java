package com.kizarov3.cdplayer;

import android.annotation.SuppressLint;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;

/**
 * Spotify's Web Playback SDK in a WebView of its own (assets/spotify/host.html), not in the app's page: Spotify's
 * script and frames get none of the page's bridges to the phone's files. The page drives it by messages
 * (src/android/spotify-player.js): `open()` (→ once its SDK has loaded), `send({ message })`, 'message' { data } back.
 * Its only way out is CdpSpotifyHost, a message channel only its own page (this origin, its main frame) can use.
 */
@CapacitorPlugin(name = "SpotifyHost")
public class SpotifyHostPlugin extends Plugin {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String PAGE = ORIGIN + "/assets/spotify/host.html";

    private WebView host;
    private JavaScriptReplyProxy reply;
    private boolean sdk;
    private PluginCall opening;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable gaveUp = () -> {
        if (opening != null) { opening.reject("Spotify's player didn't load"); opening = null; }
        destroy();
    };

    @PluginMethod public void open(PluginCall call) {
        main.post(() -> {
            if (host != null && sdk && reply != null) { call.resolve(); return; }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { call.reject("WebView too old"); return; }
            if (opening != null) opening.reject("opened again");
            opening = call;
            if (host == null) create();
            main.removeCallbacks(gaveUp);
            main.postDelayed(gaveUp, 30000);
        });
    }

    @PluginMethod public void send(PluginCall call) {
        String message = call.getString("message", "");
        main.post(() -> {
            if (reply == null) { call.reject("no player"); return; }
            reply.postMessage(message);
            call.resolve();
        });
    }

    @PluginMethod public void close(PluginCall call) {
        main.post(() -> { destroy(); call.resolve(); });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void create() {
        WebView w = host = new WebView(getActivity());
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // (the app's PLAY is the gesture; this WebView is never touched)
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/spotify/", (path) -> { // (its two files, nothing else of the app's)
                if (!path.equals("host.html") && !path.equals("host.js")) return null;
                try { return new WebResourceResponse(path.endsWith(".js") ? "text/javascript" : "text/html", "utf-8", getContext().getAssets().open("spotify/" + path)); }
                catch (java.io.IOException e) { return null; }
            }).build();
        w.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame(); // (it never goes anywhere else)
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) { request.grant(new String[] { r }); return; } // (Widevine)
                }
                request.deny();
            }
        });
        WebViewCompat.addWebMessageListener(w, "CdpSpotifyHost", Collections.singleton(ORIGIN), (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
            if (!isMainFrame || !ORIGIN.equals(sourceOrigin.toString().replaceAll("/$", ""))) return;
            String data = message.getData();
            if (data == null) return;
            reply = replyProxy;
            if (data.contains("\"type\":\"sdk\"")) {
                sdk = true;
                main.removeCallbacks(gaveUp);
                if (opening != null) { opening.resolve(); opening = null; }
                return;
            }
            JSObject m = new JSObject();
            m.put("data", data);
            notifyListeners("message", m);
        });
        // (in the window, a pixel behind the page: a WebView out of it may be held back from playing)
        ViewGroup parent = (ViewGroup) getBridge().getWebView().getParent();
        parent.addView(w, 0, new ViewGroup.LayoutParams(1, 1));
        w.loadUrl(PAGE);
    }

    private void destroy() {
        main.removeCallbacks(gaveUp);
        reply = null;
        sdk = false;
        if (host != null) {
            ViewGroup parent = (ViewGroup) host.getParent();
            if (parent != null) parent.removeView(host);
            host.destroy();
            host = null;
        }
    }

    @Override protected void handleOnDestroy() { main.post(this::destroy); }
}
