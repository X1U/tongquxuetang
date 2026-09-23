package com.picturecard.learning;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;

/** Bounded, restart-safe audio storage. Called only by the speech workers. */
final class SpeechAudioCache {
    static final int MAX_AUDIO_BYTES = 8 * 1024 * 1024;
    private static final long MAGIC = 0x5451564f49434531L; // TQVOICE1
    private final File directory;
    private final long maxBytes;
    private final int maxEntries;

    SpeechAudioCache(File directory) { this(directory, 64L * 1024 * 1024, 1000); }
    SpeechAudioCache(File directory, long maxBytes, int maxEntries) {
        this.directory = directory; this.maxBytes = maxBytes; this.maxEntries = maxEntries;
    }
    private File file(String key) {
        if (key == null || !key.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid audio key");
        return new File(directory, key + ".voice");
    }
    synchronized byte[] get(String key) {
        File file = file(key);
        if (!file.isFile()) return null;
        try (DataInputStream input = new DataInputStream(new FileInputStream(file))) {
            if (input.readLong() != MAGIC) throw new java.io.IOException("Invalid audio cache");
            int length = input.readInt();
            if (length < 500 || length > MAX_AUDIO_BYTES || file.length() != length + 44L) throw new java.io.IOException("Incomplete audio cache");
            byte[] digest = new byte[32], audio = new byte[length];
            input.readFully(digest); input.readFully(audio);
            if (!MessageDigest.isEqual(digest, MessageDigest.getInstance("SHA-256").digest(audio))) throw new java.io.IOException("Damaged audio cache");
            file.setLastModified(System.currentTimeMillis());
            return audio;
        } catch (Exception ignored) { file.delete(); return null; }
    }
    synchronized void put(String key, byte[] audio) {
        File target = file(key), temporary = null;
        if (audio == null || audio.length < 500 || audio.length > MAX_AUDIO_BYTES || audio.length + 44L > maxBytes) return;
        try {
            if (!directory.isDirectory() && !directory.mkdirs()) return;
            temporary = File.createTempFile(key + "-", ".tmp", directory);
            try (DataOutputStream output = new DataOutputStream(new FileOutputStream(temporary))) {
                output.writeLong(MAGIC); output.writeInt(audio.length);
                output.write(MessageDigest.getInstance("SHA-256").digest(audio)); output.write(audio);
            }
            if (target.exists() && !target.delete()) return;
            if (!temporary.renameTo(target)) return;
            trim(target);
        } catch (Exception ignored) { /* Storage failure never prevents playback. */ }
        finally { if (temporary != null) temporary.delete(); }
    }
    private void trim(File newest) {
        File[] files = directory.listFiles((dir, name) -> name.matches("[a-f0-9]{64}\\.voice"));
        if (files == null) return;
        Arrays.sort(files, (left, right) -> Long.compare(left.lastModified(), right.lastModified()));
        long bytes = 0; int count = files.length;
        for (File file : files) bytes += file.length();
        for (File file : files) {
            if (bytes <= maxBytes && count <= maxEntries) break;
            if (file.equals(newest)) continue;
            long size = file.length();
            if (file.delete()) { bytes -= size; count--; }
        }
    }
}
