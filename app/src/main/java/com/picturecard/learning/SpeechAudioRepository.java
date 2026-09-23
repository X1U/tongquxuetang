package com.picturecard.learning;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Shares preparation and playback requests; reserves a worker for a user's tap. */
final class SpeechAudioRepository {
    static final class Request {
        final String text, voiceId, voice, language, key;
        final double rate;
        Request(String text, double rate, String voiceId, String voice, String language) {
            this.text = text.replaceAll("[\\x00-\\x1f]", " ").trim();
            this.rate = Math.round(rate * 100) / 100.0;
            this.voiceId = voiceId; this.voice = voice; this.language = language;
            key = OnlineSpeechProtocol.hash("audio-v1\n" + voiceId + "\n" + String.format(Locale.ROOT, "%.2f", this.rate) + "\n" + this.text).toLowerCase(Locale.ROOT);
        }
    }
    static final class Cancellation {
        private volatile boolean cancelled;
        private Runnable action;
        synchronized void onCancel(Runnable action) {
            this.action = action;
            if (cancelled && action != null) action.run();
        }
        synchronized void cancel() { cancelled = true; if (action != null) action.run(); }
        void check() { if (cancelled || Thread.currentThread().isInterrupted()) throw new CancellationException(); }
    }
    interface Synthesizer { byte[] synthesize(Request request, Cancellation cancellation) throws Exception; }
    interface Callback { void ready(byte[] audio); void failed(); }
    final class Subscription {
        private final Callback callback;
        private volatile boolean cancelled;
        private Job job;
        Subscription(Callback callback) { this.callback = callback; }
        void cancel() {
            synchronized (SpeechAudioRepository.this) {
                cancelled = true;
                if (job != null) { job.listeners.remove(this); discardIfUnused(job); }
                pump();
            }
        }
    }
    private final class Job {
        final Request request;
        final Cancellation cancellation = new Cancellation();
        final List<Subscription> listeners = new ArrayList<>();
        boolean wanted, started;
        Job(Request request) { this.request = request; }
        boolean foreground() { return !listeners.isEmpty(); }
    }
    private final SpeechAudioCache disk;
    private final Synthesizer synthesizer;
    private final Executor callbacks;
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final LinkedHashMap<String, byte[]> memory = new LinkedHashMap<>(16, .75f, true);
    private final LinkedHashMap<String, Job> jobs = new LinkedHashMap<>();
    private final Set<Job> running = new HashSet<>();
    private int memoryBytes;
    private boolean closed;

    SpeechAudioRepository(SpeechAudioCache disk, Synthesizer synthesizer, Executor callbacks) {
        this.disk = disk; this.synthesizer = synthesizer; this.callbacks = callbacks;
    }
    synchronized Subscription load(Request request, Callback callback) {
        Subscription subscription = new Subscription(callback);
        byte[] cached = memory.get(request.key);
        if (closed || cached != null) { deliver(subscription, closed ? null : cached); return subscription; }
        Job job = jobs.get(request.key);
        if (job == null) { job = new Job(request); jobs.put(request.key, job); }
        subscription.job = job; job.listeners.add(subscription); pump();
        return subscription;
    }
    synchronized void prepare(List<Request> requests) {
        if (closed) return;
        LinkedHashMap<String, Request> wanted = new LinkedHashMap<>();
        for (Request request : requests) { if (wanted.size() == 6) break; wanted.put(request.key, request); }
        for (Job job : new ArrayList<>(jobs.values())) {
            job.wanted = wanted.containsKey(job.request.key); discardIfUnused(job);
        }
        for (Request request : wanted.values()) {
            if (memory.containsKey(request.key)) continue;
            Job job = jobs.get(request.key);
            if (job == null) { job = new Job(request); jobs.put(request.key, job); }
            job.wanted = true;
        }
        pump();
    }
    private void discardIfUnused(Job job) {
        if (job.wanted || job.foreground()) return;
        if (jobs.get(job.request.key) == job) jobs.remove(job.request.key);
        job.cancellation.cancel();
    }
    private void pump() {
        if (closed) return;
        while (running.size() < 2) {
            Job next = null;
            for (Job job : jobs.values()) if (!job.started && job.foreground()) { next = job; break; }
            if (next == null) {
                boolean preparing = false;
                for (Job job : running) if (!job.foreground()) preparing = true;
                if (preparing) return;
                for (Job job : jobs.values()) if (!job.started && job.wanted) { next = job; break; }
            }
            if (next == null) return;
            next.started = true; running.add(next); final Job job = next;
            workers.execute(() -> run(job));
        }
    }
    private void run(Job job) {
        byte[] audio = null;
        try {
            job.cancellation.check(); audio = disk.get(job.request.key); job.cancellation.check();
            if (audio == null) {
                audio = synthesizer.synthesize(job.request, job.cancellation); job.cancellation.check();
                if (audio == null || audio.length < 500 || audio.length > SpeechAudioCache.MAX_AUDIO_BYTES) throw new IllegalStateException("Invalid speech audio");
                disk.put(job.request.key, audio);
            }
            job.cancellation.check();
        } catch (Exception ignored) { audio = null; }
        synchronized (this) {
            running.remove(job);
            if (jobs.get(job.request.key) == job) {
                jobs.remove(job.request.key);
                if (!closed && audio != null) {
                    byte[] previous = memory.put(job.request.key, audio);
                    memoryBytes += audio.length - (previous == null ? 0 : previous.length);
                    while (memoryBytes > 8 * 1024 * 1024 || memory.size() > 100) memoryBytes -= memory.remove(memory.keySet().iterator().next()).length;
                }
                for (Subscription subscription : new ArrayList<>(job.listeners)) { subscription.job = null; deliver(subscription, audio); }
            }
            pump();
        }
    }
    private void deliver(Subscription subscription, byte[] audio) {
        callbacks.execute(() -> { if (!subscription.cancelled) { if (audio == null) subscription.callback.failed(); else subscription.callback.ready(audio); } });
    }
    synchronized void close() {
        closed = true;
        for (Job job : jobs.values()) {
            for (Subscription subscription : job.listeners) subscription.cancelled = true;
            job.cancellation.cancel();
        }
        jobs.clear(); memory.clear(); memoryBytes = 0; workers.shutdownNow();
    }
}
