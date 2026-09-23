package com.picturecard.learning;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;

public final class SpeechTransportCheck {
    static CompletableFuture<byte[]> load(SpeechAudioRepository repo, SpeechAudioRepository.Request request) {
        CompletableFuture<byte[]> result=new CompletableFuture<>();
        repo.load(request,new SpeechAudioRepository.Callback(){public void ready(byte[] bytes){result.complete(bytes);}public void failed(){result.completeExceptionally(new IllegalStateException("Online audio unavailable"));}});
        return result;
    }
    public static void main(String[] args) throws Exception {
        Path out=Path.of(args[0]);File cache=Files.createTempDirectory(out,"live-java-").resolve("audio").toFile();
        OkHttpClient client=new OkHttpClient.Builder().connectTimeout(12,TimeUnit.SECONDS).readTimeout(25,TimeUnit.SECONDS).callTimeout(30,TimeUnit.SECONDS).build();
        SpeechAudioRepository.Request request=new SpeechAudioRepository.Request("小朋友，我们一起看图，数数，读古诗吧。",.9,"online:zh-CN-XiaoxiaoNeural","zh-CN-XiaoxiaoNeural","zh-CN");
        SpeechAudioRepository repo=new SpeechAudioRepository(new SpeechAudioCache(cache),new OnlineSpeechTransport(client),Runnable::run);
        byte[] audio;double cold;
        try{long start=System.nanoTime();audio=load(repo,request).get(35,TimeUnit.SECONDS);cold=(System.nanoTime()-start)/1e6;}
        finally{repo.close();client.dispatcher().cancelAll();client.connectionPool().evictAll();client.dispatcher().executorService().shutdown();}
        repo=new SpeechAudioRepository(new SpeechAudioCache(cache),(ignored,stop)->{throw new IllegalStateException("Network disabled during cache verification");},Runnable::run);
        double warm;
        try{long start=System.nanoTime();byte[] cached=load(repo,request).get(4,TimeUnit.SECONDS);warm=(System.nanoTime()-start)/1e6;if(!Arrays.equals(audio,cached))throw new AssertionError("Cache changed the audio");}
        finally{repo.close();}
        Files.write(out.resolve("live-java.mp3"),audio);
        String json="{\"completed\":true,\"coldMilliseconds\":"+cold+",\"restartCacheMilliseconds\":"+warm+",\"bytes\":"+audio.length+",\"networkDisabledForRestart\":true,\"androidPhysicalDeviceTested\":false}";
        Files.writeString(out.resolve("live-java.json"),json);System.out.println(json);
    }
}
