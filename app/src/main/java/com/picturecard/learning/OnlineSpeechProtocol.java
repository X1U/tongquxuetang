package com.picturecard.learning;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/** Edge reading protocol, adapted from node-edge-tts 1.2.10 (MIT).
 * The public client identifier is not a user account or private API key.
 * Attribution and license are packaged in online-voice-notices.txt. */
final class OnlineSpeechProtocol {
    static final String VERSION = "143.0.3650.75";
    static final String PUBLIC_CLIENT = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    static final String BASE = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud";
    static final String USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
    static String hash(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte value : digest) result.append(String.format(Locale.ROOT, "%02X", value & 0xff));
            return result.toString();
        } catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }
    static String timestampToken(long milliseconds) {
        long ticks = (milliseconds / 1000L + 11644473600L) * 10000000L;
        ticks -= ticks % 3000000000L;
        return hash(ticks + PUBLIC_CLIENT);
    }
    static String socketUrl(long milliseconds) {
        return BASE.replace("https:", "wss:") + "/edge/v1?TrustedClientToken=" + PUBLIC_CLIENT
                + "&Sec-MS-GEC=" + timestampToken(milliseconds) + "&Sec-MS-GEC-Version=1-" + VERSION;
    }
    static String config() {
        return "Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"
                + "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}";
    }
    static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }
    static String request(String text, double speed, String name, String language, String id) {
        if (!name.matches("(zh|cmn|yue)(-[A-Za-z0-9]+)*Neural") || Double.isNaN(speed) || Double.isInfinite(speed) || speed < .35 || speed > 1.5)
            throw new IllegalArgumentException("Invalid speech parameters");
        long percent = Math.round((speed - 1) * 100);
        String rate = (percent >= 0 ? "+" : "") + percent + "%";
        return "X-RequestId:" + id + "\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n"
                + "<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"" + escape(language)
                + "\"><voice name=\"" + escape(name) + "\"><prosody rate=\"" + rate + "\" pitch=\"+0Hz\" volume=\"+0%\">"
                + escape(text) + "</prosody></voice></speak>";
    }
    static byte[] audioPacket(byte[] bytes) {
        if (bytes.length < 2) throw new IllegalArgumentException("Truncated packet");
        int length = ((bytes[0] & 255) << 8) | (bytes[1] & 255);
        if (length + 2 > bytes.length) throw new IllegalArgumentException("Truncated headers");
        String headers = new String(bytes, 2, length, StandardCharsets.UTF_8);
        if (!headers.matches("(?s)(?:.*\r\n)?Path:audio(?:\r\n.*)?")) return null;
        return Arrays.copyOfRange(bytes, length + 2, bytes.length);
    }
}
