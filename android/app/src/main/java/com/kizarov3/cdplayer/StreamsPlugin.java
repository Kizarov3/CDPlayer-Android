package com.kizarov3.cdplayer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.schabi.newpipe.extractor.Image;
import org.schabi.newpipe.extractor.InfoItem;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.StreamingService;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.downloader.Request;
import org.schabi.newpipe.extractor.downloader.Response;
import org.schabi.newpipe.extractor.playlist.PlaylistInfo;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.services.soundcloud.linkHandler.SoundcloudSearchQueryHandlerFactory;
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.DeliveryMethod;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;

/**
 * yt-dlp's place on the phone, for the desktop's streaming.js (YouTube Music, YouTube, SoundCloud): `run({ args })`
 * answers the few things it asks yt-dlp — a song's sound (-f bestaudio -J --no-playlist), SoundCloud's search
 * (scsearchN:), YouTube Music's albums (its search page's #albums) and an album or playlist (--flat-playlist -J) —
 * in yt-dlp's own JSON, found by NewPipe's extractor (no Python, no JavaScript runtime to carry). → { stdout }
 */
@CapacitorPlugin(name = "Streams")
public class StreamsPlugin extends Plugin {
    static final String VERSION = "NewPipeExtractor 0.27.1";
    private static boolean started;

    private static synchronized void start() {
        if (started) return;
        NewPipe.init(new Net());
        started = true;
    }

    @PluginMethod public void run(PluginCall call) {
        JSArray raw = call.getArray("args");
        List<String> args = new ArrayList<>();
        try { if (raw != null) for (int i = 0; i < raw.length(); i++) args.add(raw.getString(i)); } catch (JSONException e) { call.reject("bad arguments"); return; }
        new Thread(() -> {
            try {
                JSObject r = new JSObject();
                r.put("stdout", answer(args));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("ERROR: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
            }
        }).start();
    }

    static String answer(List<String> args) throws Exception {
        if (args.contains("--version")) return VERSION + "\n";
        start();
        int dash = args.indexOf("--");
        String target = dash >= 0 && dash + 1 < args.size() ? args.get(dash + 1) : args.get(args.size() - 1);
        Matcher sc = Pattern.compile("^scsearch(\\d*):(.*)$", Pattern.DOTALL).matcher(target);
        if (sc.matches()) return soundCloudSearch(sc.group(2), sc.group(1).isEmpty() ? 1 : Integer.parseInt(sc.group(1))).toString();
        if (target.startsWith("https://music.youtube.com/search?") && target.endsWith("#albums")) return youTubeMusicAlbums(target).toString();
        if (args.contains("--flat-playlist")) return playlist(target).toString();
        return song(target).toString();
    }

    // ---- What yt-dlp would say ----

    private static JSONArray thumbnails(List<Image> images) throws JSONException {
        JSONArray out = new JSONArray();
        if (images != null) for (Image i : images) {
            JSONObject t = new JSONObject().put("url", i.getUrl());
            if (i.getWidth() > 0) t.put("width", i.getWidth());
            if (i.getHeight() > 0) t.put("height", i.getHeight());
            out.put(t);
        }
        return out;
    }

    private static JSONObject entry(StreamInfoItem s) throws JSONException {
        JSONObject e = new JSONObject().put("_type", "url").put("url", s.getUrl()).put("title", s.getName())
            .put("thumbnails", thumbnails(s.getThumbnails()));
        String id = idOf(s.getUrl());
        if (id != null) e.put("id", id);
        if (s.getUploaderName() != null) { e.put("uploader", s.getUploaderName()); e.put("channel", s.getUploaderName()); }
        if (s.getDuration() > 0) e.put("duration", s.getDuration());
        return e;
    }

    private static String idOf(String url) {
        Matcher m = Pattern.compile("[?&]v=([\\w-]{11})").matcher(url == null ? "" : url);
        return m.find() ? m.group(1) : null;
    }

    static JSONObject soundCloudSearch(String query, int n) throws Exception {
        StreamingService sc = ServiceList.SoundCloud;
        SearchInfo info = SearchInfo.getInfo(sc, sc.getSearchQHFactory().fromQuery(query, Collections.singletonList(SoundcloudSearchQueryHandlerFactory.TRACKS), ""));
        JSONArray entries = new JSONArray();
        for (InfoItem it : info.getRelatedItems()) {
            if (entries.length() >= n) break;
            if (it instanceof StreamInfoItem) entries.put(entry((StreamInfoItem) it));
        }
        return new JSONObject().put("_type", "playlist").put("entries", entries);
    }

    static JSONObject youTubeMusicAlbums(String page) throws Exception {
        Matcher m = Pattern.compile("[?&]q=([^&#]*)").matcher(page);
        String query = m.find() ? URLDecoder.decode(m.group(1), "UTF-8") : "";
        StreamingService yt = ServiceList.YouTube;
        SearchInfo info = SearchInfo.getInfo(yt, yt.getSearchQHFactory().fromQuery(query, Collections.singletonList(YoutubeSearchQueryHandlerFactory.MUSIC_ALBUMS), ""));
        JSONArray entries = new JSONArray();
        for (InfoItem it : info.getRelatedItems()) {
            entries.put(new JSONObject().put("_type", "url").put("url", it.getUrl()).put("title", it.getName()).put("thumbnails", thumbnails(it.getThumbnails())));
        }
        return new JSONObject().put("_type", "playlist").put("entries", entries);
    }

    static JSONObject playlist(String page) throws Exception {
        PlaylistInfo info = PlaylistInfo.getInfo(NewPipe.getServiceByUrl(page), page);
        JSONArray entries = new JSONArray();
        for (StreamInfoItem s : info.getRelatedItems()) entries.put(entry(s));
        // (YouTube Music names an album "Album – Facelift": yt-dlp's "Album - Facelift", which streaming.js takes off)
        String name = info.getName() == null ? "" : info.getName().replaceFirst("^(Album|Single|EP) [–—-] ", "$1 - ");
        JSONObject r = new JSONObject().put("_type", "playlist").put("title", name).put("webpage_url", page)
            .put("thumbnails", thumbnails(info.getThumbnails())).put("entries", entries);
        if (info.getUploaderName() != null) r.put("uploader", info.getUploaderName());
        return r;
    }

    /** A song: its best sound to be had without signing in (the highest bitrate; a whole file before HLS pieces). */
    static JSONObject song(String page) throws Exception {
        StreamInfo info = StreamInfo.getInfo(NewPipe.getServiceByUrl(page), page);
        AudioStream best = null;
        for (AudioStream a : info.getAudioStreams()) {
            if (!a.isUrl()) continue;
            DeliveryMethod d = a.getDeliveryMethod();
            if (d != DeliveryMethod.PROGRESSIVE_HTTP && d != DeliveryMethod.HLS) continue;
            if (best == null || rank(a) > rank(best)) best = a;
        }
        if (best == null) throw new IOException("No sound to be had for this song");
        boolean hls = best.getDeliveryMethod() == DeliveryMethod.HLS;
        String ext = best.getFormat() == null ? "" : best.getFormat().getSuffix();
        String codec = best.getCodec() != null ? best.getCodec() : ext;
        if (best.getFormat() != null) {
            String name = best.getFormat().getName().toLowerCase();
            if (name.contains("opus")) { codec = "opus"; if (ext.equals("webm") || name.contains("webm")) ext = "webm"; }
            else if (ext.equals("m4a")) codec = "mp4a";
            else if (ext.equals("mp3")) codec = "mp3";
        }
        JSONObject r = new JSONObject()
            .put("url", best.getContent()).put("ext", ext).put("acodec", codec).put("protocol", hls ? "m3u8_native" : "https")
            .put("http_headers", new JSONObject().put("User-Agent", userAgentFor(best.getContent())))
            .put("title", info.getName()).put("webpage_url", page).put("thumbnails", thumbnails(info.getThumbnails()));
        int abr = best.getAverageBitrate() > 0 ? best.getAverageBitrate() : best.getBitrate() > 0 ? best.getBitrate() / 1000 : 0;
        if (abr > 0) r.put("abr", abr);
        if (info.getUploaderName() != null) r.put("uploader", info.getUploaderName());
        if (info.getDuration() > 0) r.put("duration", info.getDuration());
        if (info.getUploadDate() != null) r.put("release_year", info.getUploadDate().offsetDateTime().getYear());
        return r;
    }

    private static int rank(AudioStream a) {
        int abr = a.getAverageBitrate() > 0 ? a.getAverageBitrate() : a.getBitrate() > 0 ? a.getBitrate() / 1000 : 64;
        return abr * 2 + (a.getDeliveryMethod() == DeliveryMethod.PROGRESSIVE_HTTP ? 1 : 0)
            - (a.getAudioTrackType() != null && a.getAudioTrackType() != org.schabi.newpipe.extractor.stream.AudioTrackType.ORIGINAL ? 1000 : 0);
    }

    /** The browser a stream's address was made for (YouTube's say which client: c=). */
    private static String userAgentFor(String url) {
        Matcher m = Pattern.compile("[?&]c=([A-Z_]+)").matcher(url == null ? "" : url);
        String client = m.find() ? m.group(1) : "";
        if (client.startsWith("VISIONOS")) return YoutubeParsingHelper.getVisionOsUserAgent(null);
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
    }

    /** NewPipe's requests, over the phone's own HTTP. */
    static final class Net extends Downloader {
        @Override public Response execute(Request request) throws IOException, org.schabi.newpipe.extractor.exceptions.ReCaptchaException {
            HttpURLConnection c = (HttpURLConnection) new URL(request.url()).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod(request.httpMethod());
            c.setInstanceFollowRedirects(true);
            boolean agent = false;
            for (Map.Entry<String, List<String>> h : request.headers().entrySet()) {
                if (h.getKey().equalsIgnoreCase("User-Agent")) agent = true;
                for (String v : h.getValue()) c.addRequestProperty(h.getKey(), v);
            }
            if (!agent) c.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0");
            byte[] data = request.dataToSend();
            if (data != null) {
                c.setDoOutput(true);
                try (OutputStream out = c.getOutputStream()) { out.write(data); }
            }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String body = "";
            if (in != null) {
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
                in.close();
                body = b.toString(StandardCharsets.UTF_8.name());
            }
            Map<String, List<String>> headers = new HashMap<>();
            for (Map.Entry<String, List<String>> h : c.getHeaderFields().entrySet()) if (h.getKey() != null) headers.put(h.getKey(), h.getValue());
            String latest = c.getURL().toString(), message = c.getResponseMessage();
            c.disconnect();
            if (code == 429) throw new org.schabi.newpipe.extractor.exceptions.ReCaptchaException("reCaptcha Challenge requested", latest);
            return new Response(code, message, headers, body, latest);
        }
    }
}
