package com.picturecard.learning;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Call;
import okhttp3.OkHttpClient;

/** Downloads public releases into private cache, then asks Android to confirm installation. */
final class AppUpdateBridge {
    private final Activity activity;
    private final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService checkWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService downloadWorker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean checking = new AtomicBoolean();
    private final OkHttpClient client = new OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build();
    private final UpdateDownload transport = new UpdateDownload(client);
    private final String installUrl, appKey;
    private final File directory, readyFile;
    private volatile boolean closed;
    private volatile Call checkCall;
    private volatile Job job;
    private volatile String snapshot = "{\"state\":\"restoring\",\"message\":\"正在检查已下载的安装包…\"}";
    // All fields below belong to the main thread. Javascript reads only the immutable snapshot.
    private String state = "restoring", targetVersion = "";
    private long downloaded, total = -1;
    private boolean foreground, cachedReady, installRequested;
    private boolean waitingPermission, leftForPermission, waitingInstaller, leftForInstaller;

    AppUpdateBridge(Activity activity, WebView webView) throws Exception {
        this.activity = activity;
        this.webView = webView;
        JSONObject config;
        try (InputStream input = activity.getAssets().open("app-update.json")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 32768) throw new IOException("INVALID_CONFIG");
                output.write(buffer, 0, count);
            }
            config = new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8));
        }
        installUrl = config.getString("installUrl"); appKey = config.getString("appKey");
        if (!activity.getPackageName().equals(config.getString("packageName"))
                || !installUrl.matches("https://www\\.pgyer\\.com/[A-Za-z0-9_-]+")
                || !appKey.matches("[a-f0-9]{20,40}")) throw new IllegalArgumentException("INVALID_CONFIG");
        directory = new File(activity.getCacheDir(), "updates");
        readyFile = new File(directory, "ready.apk");
        restore();
    }

    @JavascriptInterface public String currentVersion() {
        try {
            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return new JSONObject().put("packageName", activity.getPackageName())
                    .put("versionName", info.versionName).put("versionCode", versionCode(info)).toString();
        } catch (Exception ignored) { return "{}"; }
    }

    @JavascriptInterface public void check(String requestId) {
        if (closed || requestId == null || !requestId.matches("update-[0-9]{1,8}")) return;
        if (!checking.compareAndSet(false, true)) { notifyResult(requestId, new JSONObject()); return; }
        try { checkWorker.execute(() -> {
            JSONObject result = new JSONObject();
            try {
                UpdateDownload.Page page = transport.load(installUrl, appKey, new UpdateDownload.Control() {
                    public boolean cancelled() { return closed; }
                    public void call(Call call) { checkCall = call; if (closed && call != null) call.cancel(); }
                    public void progress(long bytes, long size) {}
                });
                result.put("available", true).put("packageName", activity.getPackageName()).put("appKey", appKey)
                        .put("versionName", page.versionName).put("versionCode", JSONObject.NULL).put("notes", "")
                        .put("source", "public-page");
            } catch (Exception ignored) {
                // Never forward network responses, cookies, URLs or exception text into the WebView.
                result = new JSONObject();
            } finally { checking.set(false); }
            notifyResult(requestId, result);
        }); } catch (RejectedExecutionException ignored) { checking.set(false); }
    }

    @JavascriptInterface public String downloadState() { return snapshot; }
    @JavascriptInterface public void downloadUpdate() { main.post(this::startDownload); }
    @JavascriptInterface public void installUpdate() { main.post(this::requestInstallation); }
    @JavascriptInterface public void cancelDownload() { main.post(() -> {
        if (closed || job == null) return;
        Job previous = job; job = null; previous.cancel(); installRequested = false;
        publish(cachedReady ? "ready" : "cancelled", cachedReady ? "安装包已保留，可继续安装。" : "下载已取消，可重新下载。");
    }); }

    /** Older page links are routed back into the update dialog, never to a browser. */
    @JavascriptInterface public void openInstallPage() {
        evaluate("window.AppUpdateUI&&window.AppUpdateUI.open();");
    }

    private final class Job implements UpdateDownload.Control {
        final File partial = new File(directory, "download-" + UUID.randomUUID() + ".part");
        private volatile boolean stopped;
        private volatile Call call;
        public boolean cancelled() { return stopped || closed || job != this; }
        public void call(Call next) { call = next; if (next != null && cancelled()) next.cancel(); }
        public void progress(long bytes, long size) { post(() -> {
            downloaded = bytes; total = size; publish("downloading", "正在下载安装包…");
        }); }
        void post(Runnable action) { main.post(() -> { if (!cancelled()) action.run(); }); }
        void cancel() { stopped = true; Call active = call; if (active != null) active.cancel(); }
    }

    private void submit(Job task, Runnable work) {
        try { downloadWorker.execute(work); }
        catch (RejectedExecutionException ignored) {
            if (!closed && job == task) { job = null; installRequested = false; publish("error", "更新暂时不可用，请重新打开应用后重试。"); }
        }
    }

    private void restore() {
        Job task = new Job(); job = task;
        submit(task, () -> {
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) if (file.isFile() && file.getName().endsWith(".part")) file.delete();
            String version = null;
            if (readyFile.isFile()) {
                try { version = verify(readyFile, null); }
                catch (Exception ignored) { readyFile.delete(); }
            }
            final String restored = version;
            task.post(() -> {
                job = null; cachedReady = restored != null;
                if (cachedReady) { targetVersion = restored; downloaded = total = readyFile.length(); }
                publish(cachedReady ? "ready" : "idle", cachedReady ? "已下载 v" + restored + "，可继续安装。" : "");
            });
        });
    }

    private void startDownload() {
        if (closed || job != null || waitingPermission || waitingInstaller) return;
        if (cachedReady) { requestInstallation(); return; }
        Job task = new Job(); job = task; installRequested = true; downloaded = 0; total = -1; targetVersion = "";
        publish("preparing", "正在准备下载…");
        submit(task, () -> {
            try {
                UpdateDownload.Page page = transport.load(installUrl, appKey, task);
                PackageInfo installed = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                if (UpdatePage.compareVersions(page.versionName, installed.versionName) <= 0) throw new IOException("NO_UPDATE");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("CACHE_WRITE");
                task.post(() -> { targetVersion = page.versionName; publish("downloading", "正在下载安装包…"); });
                transport.download(page, task.partial, task);
                if (task.cancelled()) return;
                task.post(() -> publish("verifying", "下载完成，正在检查安装包…"));
                String verified = verify(task.partial, page.versionName);
                main.post(() -> {
                    if (task.cancelled()) { task.partial.delete(); return; }
                    if ((readyFile.exists() && !readyFile.delete()) || !task.partial.renameTo(readyFile)) {
                        task.partial.delete(); job = null; installRequested = false;
                        publish("error", "无法保存安装包，请检查手机可用空间后重试。"); return;
                    }
                    job = null; cachedReady = true; targetVersion = verified; downloaded = total = readyFile.length();
                    publish("ready", "下载完成，可以安装新版。");
                    launchInstallation();
                });
            } catch (Exception error) {
                task.partial.delete();
                task.post(() -> {
                    job = null; installRequested = false; cachedReady = false;
                    publish("error", errorMessage(error));
                });
            } finally { if (task.cancelled()) task.partial.delete(); }
        });
    }

    private void requestInstallation() {
        if (closed || job != null || waitingPermission || waitingInstaller) return;
        if (!cachedReady || !readyFile.isFile()) {
            cachedReady = false; installRequested = false;
            publish("error", "安装包已被清理，请重新下载。"); return;
        }
        installRequested = true;
        Job task = new Job(); job = task; publish("verifying", "正在检查安装包…");
        submit(task, () -> {
            try {
                String verified = verify(readyFile, targetVersion.isEmpty() ? null : targetVersion);
                task.post(() -> { job = null; targetVersion = verified; publish("ready", "安装包已就绪。"); launchInstallation(); });
            } catch (Exception error) {
                readyFile.delete();
                task.post(() -> { job = null; cachedReady = false; installRequested = false; publish("error", errorMessage(error)); });
            }
        });
    }

    private void launchInstallation() {
        if (closed || !foreground || !installRequested || !cachedReady || job != null || waitingPermission || waitingInstaller) return;
        if (!readyFile.isFile()) { cachedReady = false; installRequested = false; publish("error", "安装包已被清理，请重新下载。"); return; }
        try {
            if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                waitingPermission = true; leftForPermission = false;
                publish("permission", "请在系统设置中允许童趣学堂安装应用，返回后继续安装。");
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                return;
            }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", readyFile);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("童趣学堂更新", uri));
            waitingInstaller = true; leftForInstaller = false;
            publish("installing", "请在系统安装窗口中确认更新。");
            activity.startActivity(intent);
        } catch (Exception ignored) {
            waitingPermission = false; waitingInstaller = false; installRequested = false;
            publish("ready", "暂时无法打开系统安装窗口，安装包已保留，可稍后继续安装。");
        }
    }

    void onResume() {
        foreground = true;
        if (closed) return;
        if (waitingPermission && leftForPermission) {
            waitingPermission = false; leftForPermission = false;
            if (Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls()) requestInstallation();
            else { installRequested = false; publish("permission", "尚未允许安装，点“允许安装”后可继续。"); }
        } else if (waitingInstaller && leftForInstaller) {
            waitingInstaller = false; leftForInstaller = false; installRequested = false;
            publish("ready", "安装尚未完成，可继续安装。");
        } else if (installRequested && cachedReady && job == null) requestInstallation();
        evaluate("window.dispatchEvent(new Event('appupdateresume'));");
    }

    void onPause() {
        foreground = false;
        if (waitingPermission) leftForPermission = true;
        if (waitingInstaller) leftForInstaller = true;
    }

    private String verify(File file, String expectedVersion) throws Exception {
        if (!file.isFile() || file.length() < 1024 || file.length() > UpdateDownload.MAX_APK_BYTES) throw new IOException("INVALID_APK");
        PackageManager manager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (candidate == null) throw new IOException("INVALID_APK");
        PackageInfo installed = manager.getPackageInfo(activity.getPackageName(), flags);
        UpdateInstallPolicy.requireUpgrade(installed.packageName, versionCode(installed), signers(installed),
                candidate.packageName, versionCode(candidate), signers(candidate), candidate.versionName, expectedVersion);
        return candidate.versionName;
    }

    private static long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private static Set<String> signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
                ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        Set<String> result = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray());
            StringBuilder value = new StringBuilder();
            for (byte item : hash) value.append(Character.forDigit((item >>> 4) & 15, 16)).append(Character.forDigit(item & 15, 16));
            result.add(value.toString());
        }
        return result;
    }

    private static String errorMessage(Exception error) {
        String code = error.getMessage();
        if ("NO_UPDATE".equals(code)) return "当前没有可下载的新版本，请稍后检查更新。";
        if ("APK_PACKAGE".equals(code) || "APK_SIGNATURE".equals(code)) return "安装包与当前应用不匹配，已停止安装，请稍后重新下载。";
        if ("APK_VERSION".equals(code)) return "安装包版本已变化或不是新版本，请重新检查并下载。";
        if ("INVALID_APK".equals(code) || "INCOMPLETE_APK".equals(code) || "INVALID_APK_SIZE".equals(code)) return "安装包不完整或无法识别，请重新下载。";
        if ("CACHE_WRITE".equals(code)) return "无法保存安装包，请检查手机可用空间后重试。";
        return "下载未完成，请检查网络和手机可用空间后重试。";
    }

    private void publish(String nextState, String message) {
        state = nextState;
        try { snapshot = new JSONObject().put("state", state).put("message", message).put("versionName", targetVersion)
                .put("downloaded", downloaded).put("total", total).toString(); }
        catch (Exception ignored) { return; }
        evaluate("window.dispatchEvent(new CustomEvent('appupdatedownload',{detail:" + snapshot + "}));");
    }

    private void notifyResult(String id, JSONObject result) {
        evaluate("window.dispatchEvent(new CustomEvent('appupdate',{detail:{id:" + JSONObject.quote(id) + ",result:" + result + "}}));");
    }

    private void evaluate(String script) {
        main.post(() -> {
            if (!closed && !activity.isFinishing() && !activity.isDestroyed()) webView.evaluateJavascript(script, null);
        });
    }

    void close() {
        closed = true; installRequested = false;
        Job active = job; if (active != null) active.cancel();
        Call check = checkCall; if (check != null) check.cancel();
        checkWorker.shutdownNow(); downloadWorker.shutdownNow();
        client.dispatcher().cancelAll(); client.connectionPool().evictAll();
    }
}
