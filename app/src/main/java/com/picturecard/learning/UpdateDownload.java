package com.picturecard.learning;

import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Public-page download transport. Temporary tokens and cookies stay in memory. */
final class UpdateDownload {
    static final long MAX_APK_BYTES = 128L * 1024 * 1024;
    static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
    interface Control {
        boolean cancelled();
        void call(Call call);
        void progress(long bytes, long total);
    }
    static final class Page {
        final String versionName, installUrl;
        private final String html, appKey;
        private final List<Cookie> cookies;
        Page(String html, String installUrl, String appKey, List<Cookie> cookies) {
            this.html = html; this.installUrl = installUrl; this.appKey = appKey; this.cookies = cookies;
            versionName = UpdatePage.version(html, appKey);
        }
    }
    private final OkHttpClient client;
    UpdateDownload(OkHttpClient client) {
        // Redirects are checked one hop at a time; cookies never leave the public page host.
        this.client = client.newBuilder().followRedirects(false).followSslRedirects(false)
                .cookieJar(CookieJar.NO_COOKIES).cache(null).build();
    }
    private static void active(Control control) throws InterruptedIOException {
        if (control.cancelled()) throw new InterruptedIOException("CANCELLED");
    }
    Page load(String installUrl, String appKey, Control control) throws IOException {
        if (!installUrl.matches("https://www\\.pgyer\\.com/[A-Za-z0-9_-]+")) throw new IOException("INVALID_PAGE");
        active(control);
        Request request = new Request.Builder().url(installUrl).header("User-Agent", USER_AGENT).header("Accept", "text/html")
                .header("Cache-Control", "no-cache").header("Accept-Encoding", "identity").build();
        Call call = client.newCall(request); call.timeout().timeout(12, TimeUnit.SECONDS); control.call(call);
        try (Response response = call.execute()) {
            active(control);
            if (response.code() != 200 || response.body() == null || response.body().contentLength() > 262144) throw new IOException("PUBLIC_PAGE_UNAVAILABLE");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            try (InputStream input = response.body().byteStream()) {
                while ((count = input.read(buffer)) != -1) { active(control); if (bytes.size() + count > 262144) throw new IOException("PAGE_TOO_LARGE"); bytes.write(buffer, 0, count); }
            }
            return new Page(new String(bytes.toByteArray(), StandardCharsets.UTF_8), installUrl, appKey, Cookie.parseAll(request.url(), response.headers()));
        } finally { control.call(null); }
    }
    void download(Page page, File destination, Control control) throws Exception {
        URI uri = UpdatePage.downloadUrl(page.html, page.appKey, System.currentTimeMillis());
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(180); boolean complete = false;
        try {
            for (int redirects = 0; redirects <= 5; redirects++) {
                active(control);
                if (!UpdatePage.allowedDownload(uri)) throw new IOException("UNTRUSTED_DOWNLOAD");
                Request.Builder builder = new Request.Builder().url(uri.toString()).header("User-Agent", USER_AGENT)
                        .header("Referer", page.installUrl).header("Accept-Encoding", "identity");
                if ("www.pgyer.com".equalsIgnoreCase(uri.getHost())) {
                    HttpUrl url = HttpUrl.get(uri); StringBuilder cookieHeader = new StringBuilder();
                    for (Cookie cookie : page.cookies) if (cookie.expiresAt() > System.currentTimeMillis() && cookie.matches(url)) {
                        if (cookieHeader.length() > 0) cookieHeader.append("; "); cookieHeader.append(cookie.name()).append('=').append(cookie.value());
                    }
                    if (cookieHeader.length() > 8192) throw new IOException("COOKIE_TOO_LARGE");
                    if (cookieHeader.length() > 0) builder.header("Cookie", cookieHeader.toString());
                }
                long remaining = deadline - System.nanoTime(); if (remaining <= 0) throw new IOException("DOWNLOAD_TIMEOUT");
                Call call = client.newCall(builder.build()); call.timeout().timeout(remaining, TimeUnit.NANOSECONDS); control.call(call);
                try (Response response = call.execute()) {
                    active(control);
                    if (response.isRedirect()) {
                        String location = response.header("Location"); if (location == null) throw new IOException("INVALID_REDIRECT");
                        uri = uri.resolve(location); continue;
                    }
                    if (response.code() != 200 || response.body() == null) throw new IOException("DOWNLOAD_UNAVAILABLE");
                    String type = response.header("Content-Type", "").split(";", 2)[0].trim();
                    if (!(type.equalsIgnoreCase("application/vnd.android.package-archive") || type.equalsIgnoreCase("application/octet-stream") || type.equalsIgnoreCase("application/zip"))) throw new IOException("INVALID_APK");
                    long total = response.body().contentLength();
                    if (total > MAX_APK_BYTES || (total >= 0 && total < 4)) throw new IOException("INVALID_APK_SIZE");
                    try (DataInputStream input = new DataInputStream(response.body().byteStream()); FileOutputStream output = new FileOutputStream(destination)) {
                        byte[] header = new byte[4]; input.readFully(header);
                        if (header[0] != 'P' || header[1] != 'K' || header[2] != 3 || header[3] != 4) throw new IOException("INVALID_APK");
                        active(control); output.write(header); long received = header.length, lastProgress = 0;
                        byte[] buffer = new byte[32768]; int count;
                        control.progress(received, total);
                        while ((count = input.read(buffer)) != -1) {
                            active(control); received += count;
                            if (received > MAX_APK_BYTES || System.nanoTime() > deadline) throw new IOException("DOWNLOAD_LIMIT");
                            output.write(buffer, 0, count);
                            long now = System.nanoTime(); if (now - lastProgress >= 250000000) { lastProgress = now; control.progress(received, total); }
                        }
                        if (received < 1024 || (total >= 0 && received != total)) throw new IOException("INCOMPLETE_APK");
                        output.getFD().sync(); active(control); control.progress(received, received); complete = true; return;
                    }
                } finally { control.call(null); }
            }
            throw new IOException("TOO_MANY_REDIRECTS");
        } finally { if (!complete && destination.exists()) destination.delete(); }
    }
}
