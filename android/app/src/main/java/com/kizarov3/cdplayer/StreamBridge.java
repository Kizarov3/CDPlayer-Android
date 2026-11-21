package com.kizarov3.cdplayer;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/**
 * A streamed song's sound for the player (<audio> and fetch of /_cdpstream_/?u=<page>), answered by the desktop's own
 * streaming.serveStream in the page (src/android/boot.entry.js) — the desktop's cdp://app/stream. The page is asked
 * for the answer's head, then for each piece as the player reads it (nothing more is fetched once it stops), the
 * pieces coming back through `CdpStream` (head, data, end).
 */
public class StreamBridge {
    static final String PATH = "/_cdpstream_/";
    private static final byte[] END = new byte[0];

    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicInteger ids = new AtomicInteger();
    private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();

    private static final class Pending {
        final CountDownLatch headed = new CountDownLatch(1);
        final LinkedBlockingQueue<byte[]> pieces = new LinkedBlockingQueue<>();
        volatile int status;
        volatile String headers = "{}";
    }

    // The WebView cuts a request's Range out of what shouldInterceptRequest answers itself (an answer to bytes=100-199 loses
    // its first 100 bytes — a song's end, asked for first by the player, came empty and it never played): so the bytes
    // before the range come first, as filler it skips (never fetched). Checked once by the page (PROBE, `sliced`), in case a WebView doesn't.
    static final String PROBE = PATH + "probe";
    private volatile boolean sliced = true;

    StreamBridge(WebView web) { this.web = web; }

    /** The WebView's requests: ours here, the rest to Capacitor's. */
    static void install(Bridge bridge) {
        StreamBridge sb = new StreamBridge(bridge.getWebView());
        bridge.getWebView().addJavascriptInterface(sb, "CdpStream");
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("localhost".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith(PATH)) return sb.serve(request);
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private void js(String code) { main.post(() -> web.evaluateJavascript(code, null)); }

    WebResourceResponse serve(WebResourceRequest request) {
        if (PROBE.equals(request.getUrl().getPath())) { // (an answer from the start to bytes=1-1: "B" if the WebView cuts it)
            Map<String, String> h = new HashMap<>();
            h.put("Content-Range", "bytes 0-1/2");
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse("text/plain", null, 206, "Partial Content", h, new java.io.ByteArrayInputStream("AB".getBytes()));
        }
        int id = ids.incrementAndGet();
        Pending p = new Pending();
        pending.put(id, p);
        String range = null;
        for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) if (h.getKey().equalsIgnoreCase("Range")) range = h.getValue();
        js("window.__cdpStream&&__cdpStream.open(" + id + "," + JSONObject.quote(request.getUrl().toString()) + "," + (range == null ? "null" : JSONObject.quote(range)) + ")");
        try {
            if (!p.headed.await(90, TimeUnit.SECONDS)) { pending.remove(id); return text(504, "The song didn't come"); }
        } catch (InterruptedException e) { pending.remove(id); return text(504, "Stopped"); }
        Map<String, String> headers = new HashMap<>();
        String mime = "application/octet-stream";
        try {
            JSONObject h = new JSONObject(p.headers);
            for (Iterator<String> k = h.keys(); k.hasNext(); ) {
                String name = k.next(), value = h.getString(name);
                if (name.equalsIgnoreCase("content-type")) mime = value.split(";")[0].trim(); else headers.put(name, value);
            }
        } catch (Exception ignored) { }
        headers.put("Access-Control-Allow-Origin", "*");
        long skip = 0;
        if (sliced && p.status == 206) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("bytes (\\d+)-").matcher(headers.containsKey("content-range") ? headers.get("content-range") : "");
            if (m.find() && Long.parseLong(m.group(1)) > 0) {
                skip = Long.parseLong(m.group(1)); // (the headers stay the range's: the player checks them against its request)
            }
        }
        final long filler = skip;
        InputStream body = new InputStream() {
            private long skipped;
            private byte[] piece;
            private int at;
            private boolean done, asked;
            private boolean fill() throws IOException {
                while (!done && (piece == null || at >= piece.length)) {
                    if (!asked) { asked = true; js("window.__cdpStream&&__cdpStream.more(" + id + ")"); }
                    try {
                        byte[] next = p.pieces.poll(90, TimeUnit.SECONDS);
                        if (next == null) throw new IOException("the song stopped coming");
                        asked = false;
                        if (next == END) { done = true; pending.remove(id); break; }
                        piece = next;
                        at = 0;
                    } catch (InterruptedException e) { throw new IOException("stopped"); }
                }
                return !done || (piece != null && at < piece.length);
            }
            @Override public int read() throws IOException {
                if (skipped < filler) { skipped++; return 0; }
                if (!fill()) return -1;
                return piece[at++] & 0xff;
            }
            @Override public int read(byte[] b, int off, int len) throws IOException {
                if (len == 0) return 0;
                if (skipped < filler) { int n = (int) Math.min(len, filler - skipped); java.util.Arrays.fill(b, off, off + n, (byte) 0); skipped += n; return n; }
                if (!fill()) return -1;
                int n = Math.min(len, piece.length - at);
                System.arraycopy(piece, at, b, off, n);
                at += n;
                return n;
            }
            @Override public void close() {
                if (!done) { done = true; pending.remove(id); js("window.__cdpStream&&__cdpStream.cancel(" + id + ")"); }
            }
        };
        String reason = p.status == 206 ? "Partial Content" : p.status == 200 ? "OK" : p.status == 416 ? "Range Not Satisfiable" : p.status == 404 ? "Not Found" : "Error";
        return new WebResourceResponse(mime, null, p.status == 0 ? 500 : p.status, reason, headers, body);
    }

    private static WebResourceResponse text(int status, String msg) {
        return new WebResourceResponse("text/plain", "utf-8", status, "Error", new HashMap<>(), new java.io.ByteArrayInputStream(msg.getBytes()));
    }

    // ---- The page's answers ----

    @JavascriptInterface public void head(int id, int status, String headersJson) {
        Pending p = pending.get(id);
        if (p == null) return;
        p.status = status;
        p.headers = headersJson == null ? "{}" : headersJson;
        p.headed.countDown();
    }

    @JavascriptInterface public void data(int id, String base64) {
        Pending p = pending.get(id);
        if (p != null) p.pieces.offer(Base64.decode(base64, Base64.DEFAULT));
    }

    /** The page's PROBE: whether this WebView cuts the range out itself. */
    @JavascriptInterface public void setSliced(boolean value) { sliced = value; }

    @JavascriptInterface public void end(int id) {
        Pending p = pending.get(id);
        if (p != null) { p.pieces.offer(END); p.headed.countDown(); }
    }
}
