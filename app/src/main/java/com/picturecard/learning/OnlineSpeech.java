package com.picturecard.learning;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.MediaPlayer;
import android.media.AudioAttributes;
import android.media.MediaDataSource;
import android.os.Handler;
import android.os.Looper;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Optional online reading. Local TTS and packaged recordings remain independent. */
final class OnlineSpeech {
    interface Listener { void event(String id, String state); }
    private final Context context;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private final Runnable voicesChanged;
    private final SharedPreferences preferences;
    private final OkHttpClient client = new OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build();
    private final SpeechAudioRepository audio;
    private volatile String catalog = "[]";
    private boolean closed, refreshing;
    private long lastAttempt;
    private Job current;
    private static final class Job {
        final String id;
        SpeechAudioRepository.Subscription loading;
        MediaPlayer player;
        Runnable timeout;
        Job(String id) { this.id = id; }
    }
    OnlineSpeech(Context context, Listener listener, Runnable voicesChanged) {
        this.context = context.getApplicationContext(); this.listener = listener; this.voicesChanged = voicesChanged;
        audio = new SpeechAudioRepository(new SpeechAudioCache(new File(this.context.getNoBackupFilesDir(), "voices/v1")),
                new OnlineSpeechTransport(client), action -> ui.post(action));
        preferences = this.context.getSharedPreferences("online-voices-v1", Context.MODE_PRIVATE);
        try (InputStream input = this.context.getAssets().open("online-voices.json")) {
            catalog = new JSONObject(read(input, 524288)).getJSONArray("voices").toString();
        } catch (Exception ignored) { }
        try {
            String stored = preferences.getString("catalog", "[]");
            JSONArray rows = new JSONArray(stored);
            if (rows.length() > 0 && rows.length() <= 300) {
                for (int i = 0; i < rows.length(); i++) if (!validVoice(rows.getJSONObject(i))) throw new IOException("Invalid voice catalog");
                catalog = rows.toString();
            }
        } catch (Exception ignored) { }
    }
    private static String read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
        while ((count = input.read(buffer)) != -1) { if (output.size() + count > limit) throw new IOException("Response too large"); output.write(buffer, 0, count); }
        return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }
    private static boolean validVoice(JSONObject voice) {
        String name = voice.optString("shortName"), language = voice.optString("lang");
        return name.matches("(zh|cmn|yue)(-[A-Za-z0-9]+)*Neural") && language.matches("(zh|cmn|yue)(-[A-Za-z0-9]+)*")
                && voice.optString("id").equals("online:" + name);
    }
    JSONArray voices() { try { return new JSONArray(catalog); } catch (Exception ignored) { return new JSONArray(); } }
    JSONObject find(String id) {
        JSONArray rows = voices();
        for (int i = 0; i < rows.length(); i++) { JSONObject item = rows.optJSONObject(i); if (item != null && id.equals(item.optString("id"))) return item; }
        return null;
    }
    void refreshVoices() {
        long now = System.currentTimeMillis();
        if (closed || refreshing || now - lastAttempt < 60000 || now - preferences.getLong("updated", 0) < 86400000) return;
        lastAttempt = now; refreshing = true;
        Request request = new Request.Builder().url(OnlineSpeechProtocol.BASE + "/voices/list?trustedclienttoken=" + OnlineSpeechProtocol.PUBLIC_CLIENT)
                .header("User-Agent", OnlineSpeechProtocol.USER_AGENT).build();
        client.newCall(request).enqueue(new Callback() {
            @Override public void onFailure(Call call, IOException error) { ui.post(() -> refreshing = false); }
            @Override public void onResponse(Call call, Response response) {
                String updated = null;
                try (Response answer = response) {
                    if (!answer.isSuccessful() || answer.body() == null) throw new IOException("Catalog unavailable");
                    JSONArray incoming = new JSONArray(read(answer.body().byteStream(), 524288)), known = voices();
                    Map<String, JSONObject> labels = new HashMap<>(); Map<String, Integer> order = new HashMap<>();
                    for (int i = 0; i < known.length(); i++) { JSONObject row = known.getJSONObject(i); labels.put(row.getString("shortName"), row); order.put(row.getString("shortName"), i); }
                    List<JSONObject> normalized = new ArrayList<>();
                    for (int i = 0; i < incoming.length(); i++) {
                        JSONObject row = incoming.getJSONObject(i); String name = row.optString("ShortName"), language = row.optString("Locale");
                        if (!name.matches("(zh|cmn|yue)(-[A-Za-z0-9]+)*Neural") || !language.matches("(zh|cmn|yue)(-[A-Za-z0-9]+)*")) continue;
                        JSONObject old = labels.get(name), item = new JSONObject(); String[] parts = name.split("-");
                        item.put("id", "online:" + name); item.put("shortName", name); item.put("lang", language); item.put("local", false);
                        item.put("name", old != null ? old.optString("name") : parts[parts.length - 1].replace("Neural", ""));
                        item.put("group", old != null ? old.optString("group") : "zh-CN".equals(language) ? "普通话" : "zh-TW".equals(language) ? "台湾普通话" : "zh-HK".equals(language) || language.startsWith("yue") ? "粤语" : language);
                        item.put("gender", "Female".equals(row.optString("Gender")) ? "女声" : "Male".equals(row.optString("Gender")) ? "男声" : "");
                        normalized.add(item);
                    }
                    if (normalized.isEmpty() || normalized.size() > 300) throw new IOException("Empty catalog");
                    Collections.sort(normalized, (left, right) -> {
                        Integer a = order.get(left.optString("shortName")), b = order.get(right.optString("shortName"));
                        int difference = (a == null ? 999 : a) - (b == null ? 999 : b);
                        return difference != 0 ? difference : left.optString("id").compareTo(right.optString("id"));
                    });
                    JSONArray result = new JSONArray(); for (JSONObject item : normalized) result.put(item); updated = result.toString();
                } catch (Exception ignored) { }
                final String ready = updated;
                ui.post(() -> { refreshing = false; if (closed || ready == null) return; catalog = ready; preferences.edit().putString("catalog", ready).putLong("updated", System.currentTimeMillis()).apply(); voicesChanged.run(); });
            }
        });
    }
    void speak(String text, double rate, String voiceId, String id) {
        stop(); if (closed) return;
        SpeechAudioRepository.Request request = request(text, rate, voiceId);
        if (request == null) { listener.event(id, "error"); return; }
        Job job = new Job(id); current = job;
        job.timeout = () -> finish(job, "error"); ui.postDelayed(job.timeout, 35000);
        job.loading = audio.load(request, new SpeechAudioRepository.Callback() {
            @Override public void ready(byte[] bytes) { if (current == job) play(job, bytes); }
            @Override public void failed() { finish(job, "error"); }
        });
    }
    private SpeechAudioRepository.Request request(String text, double rate, String voiceId) {
        JSONObject voice = find(voiceId);
        if (voice == null || text == null || text.trim().isEmpty() || text.length() > 800 || Double.isNaN(rate) || Double.isInfinite(rate) || rate < .35 || rate > 1.5) return null;
        return new SpeechAudioRepository.Request(text, rate, voiceId, voice.optString("shortName"), voice.optString("lang"));
    }
    void prepare(String texts, double rate, String voiceId) {
        if (closed || texts == null || texts.length() > 6000) return;
        try {
            JSONArray list = new JSONArray(texts);
            List<SpeechAudioRepository.Request> requests = new ArrayList<>();
            for (int i = 0; i < Math.min(6, list.length()); i++) {
                SpeechAudioRepository.Request request = request(list.optString(i), rate, voiceId);
                if (request != null) requests.add(request);
            }
            audio.prepare(requests);
        } catch (Exception ignored) { }
    }
    void cancelPreparation() { audio.prepare(Collections.emptyList()); }
    private void play(Job job, byte[] bytes) {
        if (current != job) return;
        try {
            ui.removeCallbacks(job.timeout);
            job.player = new MediaPlayer();
            job.player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            job.player.setDataSource(new MediaDataSource() {
                @Override public int readAt(long position, byte[] buffer, int offset, int size) throws IOException {
                    if (position < 0) throw new IOException("Invalid audio position");
                    if (size == 0) return 0;
                    if (position >= bytes.length) return -1;
                    int count = Math.min(size, bytes.length - (int) position);
                    System.arraycopy(bytes, (int) position, buffer, offset, count); return count;
                }
                @Override public long getSize() { return bytes.length; }
                @Override public void close() { }
            });
            job.player.setOnPreparedListener(player -> { if (current == job) { try { ui.removeCallbacks(job.timeout); player.start(); listener.event(job.id, "start"); } catch (Exception error) { finish(job, "error"); } } });
            job.player.setOnCompletionListener(player -> finish(job, "end"));
            job.player.setOnErrorListener((player, what, extra) -> { finish(job, "error"); return true; });
            job.timeout = () -> finish(job, "error"); ui.postDelayed(job.timeout, 10000); job.player.prepareAsync();
        } catch (Exception error) { finish(job, "error"); }
    }
    private void release(Job job) {
        if (job.timeout != null) ui.removeCallbacks(job.timeout);
        if (job.loading != null) job.loading.cancel();
        if (job.player != null) { job.player.setOnPreparedListener(null); job.player.setOnCompletionListener(null); job.player.setOnErrorListener(null); job.player.release(); }
    }
    private void finish(Job job, String state) { if (current != job) return; current = null; release(job); listener.event(job.id, state); }
    void stop() { Job old = current; current = null; if (old != null) { release(old); listener.event(old.id, "cancel"); } }
    void close() { closed = true; stop(); audio.close(); client.dispatcher().cancelAll(); client.connectionPool().evictAll(); client.dispatcher().executorService().shutdown(); }
}
