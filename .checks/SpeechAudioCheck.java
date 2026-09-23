package com.picturecard.learning;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

public final class SpeechAudioCheck {
    private static final byte[] BYTES = new byte[1600];
    private static final String VOICE = "online:zh-CN-XiaoxiaoNeural";
    private static final List<String> checks = new ArrayList<>();
    static { Arrays.fill(BYTES, (byte)37); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static SpeechAudioRepository.Request request(String text) { return new SpeechAudioRepository.Request(text, .9, VOICE, "zh-CN-XiaoxiaoNeural", "zh-CN"); }
    private static void until(BooleanSupplier condition, String message) throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(4);
        while (!condition.getAsBoolean()) { check(System.nanoTime() < end, message); Thread.sleep(5); }
    }
    private static final class Result implements SpeechAudioRepository.Callback {
        final CompletableFuture<byte[]> value = new CompletableFuture<>();
        public void ready(byte[] audio) { value.complete(audio); }
        public void failed() { value.completeExceptionally(new IllegalStateException("unavailable")); }
        byte[] get() throws Exception { return value.get(4, TimeUnit.SECONDS); }
    }
    private static final class Controlled implements SpeechAudioRepository.Synthesizer {
        final List<String> started = Collections.synchronizedList(new ArrayList<>());
        final ConcurrentHashMap<String, CountDownLatch> gates = new ConcurrentHashMap<>();
        final AtomicInteger running = new AtomicInteger(), cancelled = new AtomicInteger();
        public byte[] synthesize(SpeechAudioRepository.Request request, SpeechAudioRepository.Cancellation stop) throws Exception {
            CountDownLatch gate = new CountDownLatch(1); gates.put(request.text, gate); running.incrementAndGet(); started.add(request.text);
            try { while (!gate.await(5, TimeUnit.MILLISECONDS)) stop.check(); stop.check(); return BYTES; }
            catch (java.util.concurrent.CancellationException error) { cancelled.incrementAndGet(); throw error; }
            finally { running.decrementAndGet(); gates.remove(request.text, gate); }
        }
        void release(String text) { CountDownLatch gate = gates.get(text); check(gate != null, "Waiting synthesis: " + text); gate.countDown(); }
    }
    private static SpeechAudioRepository repository(File directory, SpeechAudioRepository.Synthesizer synth) {
        return new SpeechAudioRepository(new SpeechAudioCache(directory), synth, Runnable::run);
    }
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory(Path.of(args[0]), "java-");
        SpeechAudioRepository.Request one = request("重启后继续听。");
        check(one.key.equals(request("  重启后继续听。\n").key), "Whitespace normalization matches playback");
        check(!one.key.equals(new SpeechAudioRepository.Request(one.text, 1.05, VOICE, one.voice, one.language).key), "Speed separates cache entries");
        check(!one.key.equals(new SpeechAudioRepository.Request(one.text, .9, "online:zh-CN-YunxiNeural", "zh-CN-YunxiNeural", "zh-CN").key), "Voice separates cache entries");
        check(!one.key.equals(request("不同文字。").key), "Text separates cache entries");
        checks.add("Normalized text, voice and speed cache identities");
        File directory = root.resolve("disk").toFile(); SpeechAudioCache disk = new SpeechAudioCache(directory);
        disk.put(one.key, BYTES); check(Arrays.equals(BYTES, new SpeechAudioCache(directory).get(one.key)), "Read after restart");
        Path stored = directory.toPath().resolve(one.key + ".voice"); byte[] damaged = Files.readAllBytes(stored); damaged[damaged.length - 1] ^= 1; Files.write(stored, damaged);
        check(disk.get(one.key) == null && !Files.exists(stored), "Damaged audio rejected");
        disk.put(one.key, BYTES); Files.write(stored, new byte[80]); check(disk.get(one.key) == null, "Truncated audio rejected");
        disk.put(one.key, new byte[10]); check(disk.get(one.key) == null, "Undersized audio rejected");
        checks.add("Persistent cache read, checksum integrity and truncated data rejection");
        SpeechAudioCache bounded = new SpeechAudioCache(root.resolve("bounded").toFile(), 4000, 2);
        String a=request("甲").key, b=request("乙").key, c=request("丙").key;
        bounded.put(a,BYTES); bounded.put(b,BYTES); root.resolve("bounded").resolve(b+".voice").toFile().setLastModified(1000);
        bounded.get(a); bounded.put(c,BYTES);
        check(Arrays.equals(BYTES,bounded.get(a)) && bounded.get(b)==null && Arrays.equals(BYTES,bounded.get(c)), "LRU eviction");
        checks.add("Cache byte and entry bounds with least-recently-used eviction");
        AtomicInteger synthesized = new AtomicInteger(); File persistent = root.resolve("persistent").toFile();
        SpeechAudioRepository repo = repository(persistent,(request,stop)->{synthesized.incrementAndGet();return BYTES;});
        try { Result initial=new Result(); repo.load(one,initial); check(Arrays.equals(BYTES,initial.get()),"Initial playback"); Result memory=new Result();repo.load(one,memory);check(Arrays.equals(BYTES,memory.get())&&synthesized.get()==1,"Memory hit"); }
        finally { repo.close(); }
        repo=repository(persistent,(request,stop)->{synthesized.incrementAndGet();throw new java.io.IOException("Offline");});
        try {Result reopened=new Result();repo.load(one,reopened);check(Arrays.equals(BYTES,reopened.get())&&synthesized.get()==1,"Offline restart hit");}
        finally { repo.close(); }
        checks.add("Memory reuse and offline disk reuse after repository restart");
        Controlled shared=new Controlled();repo=repository(root.resolve("shared").toFile(),shared);
        try {
            repo.prepare(List.of(request("共享题目")));until(()->shared.started.size()==1,"Preparation starts");
            Result tapped=new Result();repo.load(request("共享题目"),tapped);repo.prepare(Collections.emptyList());shared.release("共享题目");
            check(Arrays.equals(BYTES,tapped.get())&&shared.started.size()==1,"One shared synthesis survives preparation cancellation");
        } finally {repo.close();}
        checks.add("Tap shares preparation without duplicate synthesis; foreground survives preparation cancellation");
        Controlled priority=new Controlled();repo=repository(root.resolve("priority").toFile(),priority);
        try {
            repo.prepare(List.of(request("准备一"),request("准备二")));until(()->priority.started.size()==1,"First preparation starts");Thread.sleep(40);
            check(priority.started.equals(List.of("准备一")),"Only one speculative worker");
            Result tapped=new Result();repo.load(request("用户点击"),tapped);until(()->priority.started.contains("用户点击"),"Reserved worker starts tap");
            check(!priority.started.contains("准备二"),"Second preparation remains queued");priority.release("用户点击");check(Arrays.equals(BYTES,tapped.get()),"Tap result");
            repo.prepare(Collections.emptyList());until(()->priority.running.get()==0,"Background work cancelled");
            check(!priority.started.contains("准备二"),"Cancelled queue never starts");
        } finally {repo.close();}
        checks.add("One preparation worker, foreground priority, running cancellation and stale queue removal");
        Controlled stale=new Controlled();repo=repository(root.resolve("stale").toFile(),stale);
        try {
            Result cancelled=new Result();SpeechAudioRepository.Subscription subscription=repo.load(request("换题"),cancelled);
            until(()->stale.started.size()==1,"Old request starts");subscription.cancel();until(()->stale.running.get()==0,"Old request stops");
            Result latest=new Result();repo.load(request("换题"),latest);until(()->stale.started.size()==2,"Replacement starts");stale.release("换题");
            check(Arrays.equals(BYTES,latest.get())&&!cancelled.value.isDone(),"No stale callback");
        } finally {repo.close();}
        checks.add("Cancellation prevents stale callbacks and leaves replacement requests intact");
        File unavailable=root.resolve("not-a-directory").toFile();Files.writeString(unavailable.toPath(),"fixture");repo=repository(unavailable,(request,stop)->BYTES);
        try {Result result=new Result();repo.load(one,result);check(Arrays.equals(BYTES,result.get()),"Disk failure falls back to playback");}finally{repo.close();}
        checks.add("Unavailable persistent storage does not prevent playback");
        File exchange=Path.of(args[0],"java-cache-exchange").toFile();new SpeechAudioCache(exchange).put(one.key,BYTES);
        StringBuilder json=new StringBuilder("{\"completed\":true,\"checks\":[");
        for(int i=0;i<checks.size();i++){if(i>0)json.append(',');json.append('"').append(checks.get(i)).append('"');}
        json.append("],\"exchangeKey\":\"").append(one.key).append("\"}");
        Files.writeString(Path.of(args[0],"java.json"),json.toString());System.out.println(json);
    }
}
