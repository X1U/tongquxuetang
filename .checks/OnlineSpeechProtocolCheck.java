package com.picturecard.learning;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;

public final class OnlineSpeechProtocolCheck {
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    public static void main(String[] args) throws Exception {
        String text = "你好，欢迎来到童趣学堂。我们一起看图，数数，读古诗。";
        String xml = OnlineSpeechProtocol.request("学习<&>\"'", .65, "zh-CN-XiaoxiaoNeural", "zh-CN", "test");
        check(xml.contains("rate=\"-35%\"") && xml.contains("&lt;&amp;&gt;&quot;&apos;"), "Rate and XML escaping");
        byte[] headers = "Content-Type:audio/mpeg\r\nPath:audio\r\n".getBytes(StandardCharsets.UTF_8);
        byte[] packet = new byte[headers.length + 5]; packet[0] = (byte)(headers.length >> 8); packet[1] = (byte)headers.length;
        System.arraycopy(headers, 0, packet, 2, headers.length); packet[headers.length + 2] = 1; packet[headers.length + 3] = 2; packet[headers.length + 4] = 3;
        check(Arrays.equals(OnlineSpeechProtocol.audioPacket(packet), new byte[]{1,2,3}), "Binary frame extraction");
        try { OnlineSpeechProtocol.audioPacket(new byte[]{(byte)255,(byte)255}); throw new AssertionError("Truncation accepted"); } catch (IllegalArgumentException expected) { }
        check(OnlineSpeechProtocol.timestampToken(1789689600000L).equals(args[1]), "Android and Node timestamp signatures agree");
        Files.createDirectories(Path.of(args[0]));
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(12)).build();
        for (String voice : new String[]{"zh-CN-XiaoxiaoNeural", "zh-HK-HiuMaanNeural"}) {
            CompletableFuture<byte[]> result = new CompletableFuture<>();
            ByteArrayOutputStream audio = new ByteArrayOutputStream(), frame = new ByteArrayOutputStream();
            StringBuilder texts = new StringBuilder();
            WebSocket socket = client.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(12))
                    .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                    .header("User-Agent", OnlineSpeechProtocol.USER_AGENT)
                    .buildAsync(URI.create(OnlineSpeechProtocol.socketUrl(System.currentTimeMillis())), new WebSocket.Listener() {
                        @Override public void onOpen(WebSocket ws) {
                            ws.sendText(OnlineSpeechProtocol.config(), true).thenCompose(ignored -> ws.sendText(OnlineSpeechProtocol.request(text, .9, voice, voice.substring(0,5), UUID.randomUUID().toString().replace("-", "")), true)).exceptionally(error -> { result.completeExceptionally(error); return null; });
                            ws.request(1);
                        }
                        @Override public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
                            byte[] bytes = new byte[data.remaining()]; data.get(bytes); frame.write(bytes, 0, bytes.length);
                            if (last) { byte[] part = OnlineSpeechProtocol.audioPacket(frame.toByteArray()); frame.reset(); if (part != null) audio.write(part, 0, part.length); }
                            ws.request(1); return null;
                        }
                        @Override public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
                            texts.append(data);
                            if (last) { if (texts.toString().contains("Path:turn.end")) { result.complete(audio.toByteArray()); ws.sendClose(1000, "done"); } texts.setLength(0); }
                            ws.request(1); return null;
                        }
                        @Override public CompletionStage<?> onClose(WebSocket ws, int status, String reason) { if (!result.isDone()) result.completeExceptionally(new IllegalStateException("Closed before audio completed")); return null; }
                        @Override public void onError(WebSocket ws, Throwable error) { result.completeExceptionally(error); }
                    }).get(15, TimeUnit.SECONDS);
            try { byte[] bytes = result.get(30, TimeUnit.SECONDS); check(bytes.length > 1000, "Actual Java protocol audio"); Files.write(Path.of(args[0], "android-protocol-" + voice + ".mp3"), bytes); System.out.println(voice + " Java protocol audio: " + bytes.length + " bytes"); }
            finally { socket.abort(); }
        }
        System.out.println("Android protocol checks passed; two real audio files saved.");
    }
}
