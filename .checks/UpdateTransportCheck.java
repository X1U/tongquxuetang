package com.picturecard.learning;

import java.io.File;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.Call;
import okhttp3.Interceptor;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;

/** Host JVM checks exercise the production parser, transport and install identity policy. */
public final class UpdateTransportCheck {
    static final String KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", PAGE="https://www.pgyer.com/fixture";
    static final String HTML="var agKey='"+KEY+"',aType='android',aVersion='1.17',aKey='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',"
            +"installToken='fixture-only-token',authcode='12345',timeSign='4162436445664768496a4b6c',downloadPayMoney='0',isTeamInstall='false',sig='';";
    static int passed;
    interface Checked { void run() throws Exception; }
    static void require(boolean value,String label) { if(!value)throw new AssertionError(label); }
    static void rejects(Checked work,String label) throws Exception {
        boolean rejected=false;try{work.run();}catch(Exception expected){rejected=true;}
        require(rejected,label);passed++;
    }
    static class Control implements UpdateDownload.Control {
        boolean stopped,cancelOnProgress;Call active;long bytes,total;int progress;
        public boolean cancelled(){return stopped;}
        public void call(Call call){active=call;if(stopped&&call!=null)call.cancel();}
        public void progress(long bytes,long total){this.bytes=bytes;this.total=total;progress++;if(cancelOnProgress){stopped=true;if(active!=null)active.cancel();}}
    }
    static byte[] apk() { byte[] bytes=new byte[4096];bytes[0]='P';bytes[1]='K';bytes[2]=3;bytes[3]=4;return bytes; }
    static Response reply(Interceptor.Chain chain,int code,String type,byte[] bytes,long declared) {
        BufferedSource source=new Buffer().write(bytes);
        ResponseBody body=new ResponseBody(){public MediaType contentType(){return MediaType.get(type);}public long contentLength(){return declared;}public BufferedSource source(){return source;}};
        return new Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
                .header("Content-Type",type).body(body).build();
    }
    static Response page(Interceptor.Chain chain){
        byte[] content=HTML.getBytes(StandardCharsets.UTF_8);
        return reply(chain,200,"text/html",content,content.length).newBuilder().header("Set-Cookie","fixture=memory-only; Path=/; Secure; HttpOnly").build();
    }
    static UpdateDownload transport(Interceptor interceptor){return new UpdateDownload(new OkHttpClient.Builder().addInterceptor(interceptor).build());}
    static void parserAndIdentity() throws Exception {
        require(UpdatePage.version(HTML,KEY).equals("1.17"),"public version");
        URI uri=UpdatePage.downloadUrl(HTML,KEY,1700000123456L);
        require(uri.getPath().equals("/app/install/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),"public build route");
        require(uri.getQuery().contains("finalCode="+(12345^123456)+"123456"),"public button code");
        require(uri.getQuery().contains("timeSign=6162636465666768696a6b6c"),"public button time field");
        require(uri.getQuery().contains("installToken=fixture-only-token")&&!uri.getQuery().contains("_api_key"),"no private account key");
        require(UpdatePage.downloadUrl(HTML.replace("fixture-only-token","fixture%2Ftoken:opaque"),KEY,1700000123456L).getRawQuery().contains("installToken=fixture%252Ftoken%3Aopaque"),"opaque public token is encoded as one query value");
        passed++;
        for(String html:new String[]{HTML.replace(KEY,"other"),HTML.replace("'android'","'ios'"),HTML.replace("'1.17'","'<script>'"),
                HTML.replace("'fixture-only-token'","''"),HTML.replace("downloadPayMoney='0'","downloadPayMoney='1'"),
                HTML.replace("isTeamInstall='false'","isTeamInstall='true'"),HTML.replace("isTeamInstall='false'","isTeamInstall=true"),"<html>error</html>"})
            rejects(()->UpdatePage.downloadUrl(html,KEY,1700000123456L),"malformed or non-public page");
        for(String url:new String[]{"http://www.pgyer.com/a","https://evil.example/a","https://www.pgyer.com.evil.example/a","https://user@www.pgyer.com/a","https://cos3.pgyer.com:8443/a","https://www.pgyer.com/a#x","file:///tmp/a"})
            require(!UpdatePage.allowedDownload(URI.create(url)),"untrusted redirect");
        require(UpdatePage.allowedDownload(URI.create("https://cos3.pgyer.com/file")),"public CDN");passed++;
        require(UpdatePage.compareVersions("1.100","1.17")>0&&UpdatePage.compareVersions("1.017.0","1.17")==0&&UpdatePage.compareVersions("99999999999999999999999999","99999999999999999999999998")>0,"numeric version comparison");passed++;
        Set<String> signers=Set.of("certificate-a");
        UpdateInstallPolicy.requireUpgrade("com.picturecard.learning",17,signers,"com.picturecard.learning",18,signers,"1.17","1.17");passed++;
        rejects(()->UpdateInstallPolicy.requireUpgrade("app",17,signers,"other",18,signers,"1.17","1.17"),"wrong package");
        rejects(()->UpdateInstallPolicy.requireUpgrade("app",17,signers,"app",18,Set.of("other"),"1.17","1.17"),"wrong signer");
        rejects(()->UpdateInstallPolicy.requireUpgrade("app",17,Set.of(),"app",18,Set.of(),"1.17","1.17"),"missing signers");
        for(long code:new long[]{16,17})rejects(()->UpdateInstallPolicy.requireUpgrade("app",17,signers,"app",code,signers,"1.17",null),"downgrade or reinstall");
        rejects(()->UpdateInstallPolicy.requireUpgrade("app",17,signers,"app",18,signers,"1.18","1.17"),"changed release metadata");
        rejects(()->UpdateInstallPolicy.requireUpgrade("app",17,signers,"app",18,signers,"bad",null),"invalid release name");
    }
    static void downloadCases(Path out) throws Exception {
        AtomicInteger calls=new AtomicInteger();byte[] data=apk();Control control=new Control();File target=out.resolve("transport-fixture.apk").toFile();
        UpdateDownload downloader=transport(chain->{
            calls.incrementAndGet();
            if(chain.request().url().encodedPath().equals("/fixture"))return page(chain);
            if(chain.request().url().host().equals("www.pgyer.com")){
                require("fixture=memory-only".equals(chain.request().header("Cookie")),"page cookies on page host");
                return reply(chain,302,"text/plain",new byte[0],0).newBuilder().header("Location","https://cos3.pgyer.com/file.apk").build();
            }
            require(chain.request().header("Cookie")==null,"no cookies to CDN");require(PAGE.equals(chain.request().header("Referer")),"clean fixed referer");
            return reply(chain,200,"application/vnd.android.package-archive",data,data.length);
        });
        downloader.download(downloader.load(PAGE,KEY,control),target,control);
        require(Arrays.equals(data,Files.readAllBytes(target.toPath()))&&calls.get()==3&&control.bytes==4096&&control.total==4096&&control.active==null,"redirect, progress and exact bytes");target.delete();passed++;
        for(String mode:new String[]{"truncated","oversize","html","badzip","failure","redirect","loop","cancel","small"}){
            AtomicInteger requests=new AtomicInteger();Control c=new Control();c.cancelOnProgress=mode.equals("cancel");
            UpdateDownload transport=transport(chain->{
                requests.incrementAndGet();if(chain.request().url().encodedPath().equals("/fixture"))return page(chain);
                if(mode.equals("redirect")||mode.equals("loop"))return reply(chain,302,"text/plain",new byte[0],0).newBuilder().header("Location",mode.equals("redirect")?"https://untrusted.example/file.apk":"https://cos3.pgyer.com/loop").build();
                return reply(chain,mode.equals("failure")?503:200,mode.equals("html")?"text/html":"application/octet-stream",
                        mode.equals("badzip")?new byte[4096]:mode.equals("small")?Arrays.copyOf(data,20):data,
                        mode.equals("oversize")?UpdateDownload.MAX_APK_BYTES+1:mode.equals("truncated")?4097:mode.equals("small")?20:4096);
            });
            UpdateDownload.Page page=transport.load(PAGE,KEY,c);
            rejects(()->transport.download(page,target,c),mode);
            require(!target.exists()&&c.active==null,"failed/cancelled files removed");
            if(mode.equals("redirect"))require(requests.get()==2,"unsafe host never contacted");
            if(mode.equals("loop"))require(requests.get()==7,"redirects bounded");
        }
        Control unknown=new Control();UpdateDownload chunked=transport(chain->chain.request().url().encodedPath().equals("/fixture")?page(chain):reply(chain,200,"application/octet-stream",data,-1));
        chunked.download(chunked.load(PAGE,KEY,unknown),target,unknown);require(unknown.total==4096&&unknown.bytes==4096,"unknown length completes");target.delete();passed++;
        Control cancelled=new Control();cancelled.stopped=true;
        rejects(()->downloader.load(PAGE,KEY,cancelled),"cancel before request");
        UpdateDownload tooLarge=transport(chain->reply(chain,200,"text/html",new byte[262145],262145));
        rejects(()->tooLarge.load(PAGE,KEY,new Control()),"bounded metadata");
    }
    public static void main(String[] args) throws Exception {
        Path out=Path.of(args[0]);Files.createDirectories(out);parserAndIdentity();downloadCases(out);
        String live="null";
        if(args.length>1){
            UpdateDownload downloader=new UpdateDownload(new OkHttpClient());Control control=new Control();
            UpdateDownload.Page page=downloader.load(args[1],args[2],control);File destination=out.resolve("native-transport-public.apk").toFile();
            try { downloader.download(page,destination,control); }
            catch (Exception failure) {
                var field=UpdateDownload.Page.class.getDeclaredField("html");field.setAccessible(true);String html=(String)field.get(page);
                String[] names={"aKey","installToken","authcode","timeSign","downloadPayMoney","isTeamInstall"};
                String[] patterns={"[a-f0-9]{32}","[\\x21-\\x7e]{10,512}","[0-9]{1,15}","[a-fA-F0-9]{24}","0","false"};
                StringBuilder shapes=new StringBuilder("{");
                for(int i=0;i<names.length;i++){
                    var match=java.util.regex.Pattern.compile("\\b"+names[i]+"\\s*=\\s*['\"]([^'\"]{0,512})['\"]").matcher(html);
                    String value=match.find()?match.group(1):null;
                    if(i>0)shapes.append(',');shapes.append('"').append(names[i]).append("\":{\"present\":").append(value!=null).append(",\"length\":").append(value==null?0:value.length()).append(",\"matches\":").append(value!=null&&value.matches(patterns[i])).append('}');
                }
                Files.writeString(out.resolve("public-field-shapes.json"),shapes.append('}').toString());throw failure;
            }
            String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(destination.toPath())));
            require(hash.equals(args[3]),"live public download matches published archive");
            live="{\"version\":\""+page.versionName+"\",\"bytes\":"+destination.length()+",\"sha256\":\""+hash+"\",\"archiveMatches\":true}";
        }
        String report="{\"completed\":true,\"productionJavaCases\":"+passed+",\"liveDownload\":"+live+"}";
        Files.writeString(out.resolve(args.length>1?"java-live.json":"java-unit.json"),report);System.out.println(report);
    }
}
