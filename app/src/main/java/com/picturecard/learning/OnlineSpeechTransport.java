package com.picturecard.learning;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/** Network work stays off the Android UI thread, including retries and packet copies. */
final class OnlineSpeechTransport implements SpeechAudioRepository.Synthesizer {
    private final OkHttpClient client;
    OnlineSpeechTransport(OkHttpClient client) { this.client = client; }
    private static final class Failure extends IOException {
        final boolean retryable;
        Failure(boolean retryable) { super("Online speech unavailable"); this.retryable = retryable; }
    }
    @Override public byte[] synthesize(SpeechAudioRepository.Request request, SpeechAudioRepository.Cancellation cancellation) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
        for (int attempt = 0; ; attempt++) {
            cancellation.check();
            try { return download(request, cancellation, deadline); }
            catch (Failure error) {
                cancellation.check();
                if (!error.retryable || attempt == 1 || deadline - System.nanoTime() < TimeUnit.MILLISECONDS.toNanos(1500)) throw error;
                Thread.sleep(400);
            }
        }
    }
    private byte[] download(SpeechAudioRepository.Request speech, SpeechAudioRepository.Cancellation cancellation, long deadline) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicBoolean finished = new AtomicBoolean();
        ByteArrayOutputStream audio = new ByteArrayOutputStream();
        byte[][] result = new byte[1][];
        Failure[] failure = new Failure[1];
        Request request = new Request.Builder().url(OnlineSpeechProtocol.socketUrl(System.currentTimeMillis()))
                .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                .header("User-Agent", OnlineSpeechProtocol.USER_AGENT).header("Cache-Control", "no-cache").build();
        WebSocket socket = client.newWebSocket(request, new WebSocketListener() {
            private void fail(boolean retryable) {
                if (finished.compareAndSet(false, true)) { failure[0] = new Failure(retryable); done.countDown(); }
            }
            @Override public void onOpen(WebSocket socket, Response response) {
                try {
                    cancellation.check();
                    if (!socket.send(OnlineSpeechProtocol.config()) || !socket.send(OnlineSpeechProtocol.request(speech.text, speech.rate, speech.voice, speech.language, UUID.randomUUID().toString().replace("-", "")))) fail(true);
                } catch (Exception ignored) { fail(false); }
            }
            @Override public void onMessage(WebSocket socket, ByteString data) {
                if (finished.get()) return;
                try {
                    byte[] bytes = OnlineSpeechProtocol.audioPacket(data.toByteArray());
                    if (bytes == null) return;
                    if (audio.size() + bytes.length > SpeechAudioCache.MAX_AUDIO_BYTES) { fail(false); return; }
                    audio.write(bytes, 0, bytes.length);
                } catch (Exception ignored) { fail(false); }
            }
            @Override public void onMessage(WebSocket socket, String message) {
                if (!message.matches("(?s)(?:.*\r\n)?Path:turn.end(?:\r\n.*)?")) return;
                if (audio.size() < 500) { fail(false); return; }
                if (finished.compareAndSet(false, true)) { result[0] = audio.toByteArray(); done.countDown(); }
            }
            @Override public void onFailure(WebSocket socket, Throwable error, Response response) { fail(response == null || response.code() >= 500); }
            @Override public void onClosing(WebSocket socket, int code, String reason) { socket.close(1000, null); fail(true); }
            @Override public void onClosed(WebSocket socket, int code, String reason) { fail(true); }
        });
        cancellation.onCancel(() -> { socket.cancel(); done.countDown(); });
        try {
            cancellation.check();
            if (!done.await(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS)) throw new Failure(false);
            cancellation.check();
            if (failure[0] != null) throw failure[0];
            if (result[0] == null) throw new Failure(false);
            return result[0];
        } finally { finished.set(true); cancellation.onCancel(null); socket.cancel(); }
    }
}
