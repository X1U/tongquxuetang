package com.picturecard.learning;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.view.Window;
import android.graphics.Color;
import android.widget.FrameLayout;

import java.util.Locale;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** A small offline WebView shell for the self-contained learning game. */
public final class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private WebView webView;
    private AppUpdateBridge appUpdates;
    private TextToSpeech textToSpeech;
    private OnlineSpeech onlineSpeech;
    private volatile boolean ttsReady;
    private boolean ttsInitialized;
    private String pendingText;
    private double pendingRate = 0.92;
    private String pendingUtteranceId = "picture-card-answer";
    private volatile String selectedVoiceName = "";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(247, 248, 242));
        window.setNavigationBarColor(Color.rgb(247, 248, 242));
        window.getDecorView().setSystemUiVisibility(android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(247, 248, 242));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient() {
            private boolean intercept(String url) {
                // Only packaged content may keep access to JavaScript interfaces.
                if ("file:///android_asset/index.html".equals(url)
                        || url.startsWith("file:///android_asset/index.html#")) return false;
                if (url.startsWith("https://www.pgyer.com/") && appUpdates != null) appUpdates.openInstallPage();
                else {
                    Uri reference = Uri.parse(url);
                    if ("https".equals(reference.getScheme()) && "hanyu.baidu.com".equals(reference.getHost())
                            && reference.getUserInfo() == null && (reference.getPort() == -1 || reference.getPort() == 443)
                            && ("/shici/detail".equals(reference.getPath()) || "/s".equals(reference.getPath())
                                || "/hanyu-page/poem/list".equals(reference.getPath()))) {
                        try {
                            Intent browser = new Intent(Intent.ACTION_VIEW, reference);
                            browser.addCategory(Intent.CATEGORY_BROWSABLE);
                            startActivity(browser);
                        } catch (android.content.ActivityNotFoundException ignored) {
                            android.widget.Toast.makeText(MainActivity.this, "请安装浏览器后查看参考资料", android.widget.Toast.LENGTH_SHORT).show();
                        }
                    }
                }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return intercept(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return intercept(url); }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new AndroidTtsBridge(), "AndroidTts");
        try {
            appUpdates = new AppUpdateBridge(this, webView);
            webView.addJavascriptInterface(appUpdates, "AppUpdates");
        } catch (Exception ignored) { /* Offline activities stay available if update configuration cannot load. */ }
        FrameLayout rootView = new FrameLayout(this);
        rootView.setFitsSystemWindows(true);
        rootView.setBackgroundColor(Color.rgb(247, 248, 242));
        rootView.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(rootView);

        onlineSpeech = new OnlineSpeech(getApplicationContext(), (id, state) -> {
            notifySpeech(id, state);
            if ("error".equals(state)) android.widget.Toast.makeText(MainActivity.this, "在线声音暂时无法播放，请检查网络或切换本机声音。", android.widget.Toast.LENGTH_LONG).show();
        }, this::notifyVoicesReady);
        onlineSpeech.refreshVoices();
        textToSpeech = new TextToSpeech(getApplicationContext(), this);
        webView.loadUrl("file:///android_asset/index.html#home");
    }

    @Override
    public void onInit(int status) {
        ttsInitialized = status == TextToSpeech.SUCCESS;
        ttsReady = status == TextToSpeech.SUCCESS;
        if (ttsReady && textToSpeech != null) {
            textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { notifySpeech(id, "start"); }
                @Override public void onDone(String id) { notifySpeech(id, "end"); }
                @Override public void onError(String id) { notifySpeech(id, "error"); }
                @Override public void onError(String id, int errorCode) { notifySpeech(id, "error"); }
                @Override public void onStop(String id, boolean interrupted) { notifySpeech(id, "cancel"); }
            });
            configureChineseLanguage();
            applySelectedVoice();
            notifyVoicesReady();
            if (ttsReady && pendingText != null) {
                speakNow(pendingText, pendingRate, pendingUtteranceId);
                pendingText = null;
            }
        }
        if (!ttsReady && pendingText != null) notifySpeech(pendingUtteranceId, "error");
    }

    private void configureChineseLanguage() {
        if (textToSpeech == null) {
            ttsReady = false;
            return;
        }
        int languageStatus = textToSpeech.setLanguage(Locale.SIMPLIFIED_CHINESE);
        if (languageStatus == TextToSpeech.LANG_MISSING_DATA || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
            languageStatus = textToSpeech.setLanguage(Locale.CHINA);
        }
        if (languageStatus == TextToSpeech.LANG_MISSING_DATA || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
            languageStatus = textToSpeech.setLanguage(Locale.CHINESE);
        }
        ttsReady = languageStatus != TextToSpeech.LANG_MISSING_DATA
                && languageStatus != TextToSpeech.LANG_NOT_SUPPORTED
                && languageStatus != TextToSpeech.ERROR;
    }

    private static boolean isChineseVoice(Voice voice) {
        return voice != null && voice.getLocale() != null
                && ("zh".equalsIgnoreCase(voice.getLocale().getLanguage())
                    || "cmn".equalsIgnoreCase(voice.getLocale().getLanguage())
                    || "yue".equalsIgnoreCase(voice.getLocale().getLanguage()));
    }

    private List<Voice> chineseVoices() {
        List<Voice> result = new ArrayList<>();
        if (textToSpeech == null || !ttsReady) return result;
        Set<Voice> available = textToSpeech.getVoices();
        if (available != null) for (Voice voice : available) if (isChineseVoice(voice)) result.add(voice);
        Collections.sort(result, (left, right) -> left.getName().compareToIgnoreCase(right.getName()));
        return result;
    }

    private void applySelectedVoice() {
        if (selectedVoiceName != null && selectedVoiceName.startsWith("online:")) return;
        if (textToSpeech == null || !ttsReady) return;
        if (selectedVoiceName == null || selectedVoiceName.isEmpty()) {
            configureChineseLanguage();
            return;
        }
        for (Voice voice : chineseVoices()) {
            if (selectedVoiceName.equals(voice.getName())) {
                textToSpeech.setVoice(voice);
                return;
            }
        }
        selectedVoiceName = "";
        configureChineseLanguage();
    }

    private void notifyVoicesReady() {
        runOnUiThread(() -> {
            if (webView != null && !isFinishing() && !isDestroyed())
                webView.evaluateJavascript("window.GlobalVoice&&window.GlobalVoice.refresh();", null);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (appUpdates != null) appUpdates.onResume();
        if (onlineSpeech != null) onlineSpeech.refreshVoices();
        if (textToSpeech != null && ttsInitialized) {
            configureChineseLanguage();
            applySelectedVoice();
            notifyVoicesReady();
        }
        if (ttsReady && pendingText != null) {
            speakNow(pendingText, pendingRate, pendingUtteranceId);
            pendingText = null;
        }
    }

    private void notifySpeech(String id, String state) {
        if (id == null || !(id.startsWith("poetry-") || id.startsWith("listening-"))) return;
        runOnUiThread(() -> {
            if (webView != null && !isFinishing() && !isDestroyed()) {
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('androidtts',{detail:{id:"
                        + JSONObject.quote(id) + ",state:" + JSONObject.quote(state) + "}}));", null);
            }
        });
    }

    private void speakNow(String text, double rate, String utteranceId) {
        if (selectedVoiceName.startsWith("online:") && onlineSpeech != null) {
            if (textToSpeech != null) textToSpeech.stop();
            onlineSpeech.speak(text, rate, selectedVoiceName, utteranceId);
            return;
        }
        if (onlineSpeech != null) onlineSpeech.stop();
        if (textToSpeech == null || text == null || text.trim().isEmpty()) return;
        textToSpeech.setSpeechRate((float) Math.max(0.35, Math.min(1.5, rate)));
        if (textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId) == TextToSpeech.ERROR)
            notifySpeech(utteranceId, "error");
    }

    private final class AndroidTtsBridge {
        @JavascriptInterface
        public void speak(final String text, final double rate) {
            speakWithId(text, rate, "picture-card-answer");
        }

        @JavascriptInterface
        public void speakWithId(final String text, final double rate, final String utteranceId) {
            runOnUiThread(() -> {
                if (text == null || text.trim().isEmpty() || utteranceId == null) return;
                if (text.length() > TextToSpeech.getMaxSpeechInputLength() || !utteranceId.matches("[a-zA-Z0-9-]{1,80}")) {
                    notifySpeech(utteranceId, "error");
                    return;
                }
                if (!selectedVoiceName.startsWith("online:") && (!ttsReady || textToSpeech == null)) {
                    pendingText = text;
                    pendingRate = rate;
                    pendingUtteranceId = utteranceId;
                    return;
                }
                speakNow(text, rate, utteranceId);
            });
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(() -> {
                pendingText = null;
                if (onlineSpeech != null) onlineSpeech.stop();
                if (textToSpeech != null) textToSpeech.stop();
            });
        }

        @JavascriptInterface
        public void prepare(final String texts, final double rate, final String voiceId) {
            runOnUiThread(() -> {
                if (onlineSpeech != null && selectedVoiceName.equals(voiceId) && voiceId.startsWith("online:"))
                    onlineSpeech.prepare(texts, rate, voiceId);
            });
        }

        @JavascriptInterface
        public void cancelPreparation() {
            runOnUiThread(() -> { if (onlineSpeech != null) onlineSpeech.cancelPreparation(); });
        }

        @JavascriptInterface
        public boolean isReady() {
            return ttsReady || (onlineSpeech != null && selectedVoiceName.startsWith("online:") && onlineSpeech.find(selectedVoiceName) != null);
        }

        @JavascriptInterface
        public String listVoices() {
            JSONArray result = new JSONArray();
            for (Voice voice : chineseVoices()) {
                JSONObject item = new JSONObject();
                try {
                    item.put("id", voice.getName());
                    item.put("name", voice.getName());
                    item.put("lang", voice.getLocale().toLanguageTag());
                    item.put("local", !voice.isNetworkConnectionRequired());
                    result.put(item);
                } catch (Exception ignored) { }
            }
            if (onlineSpeech != null) {
                JSONArray online = onlineSpeech.voices();
                for (int i = 0; i < online.length(); i++) result.put(online.optJSONObject(i));
            }
            return result.toString();
        }

        @JavascriptInterface
        public void setVoice(final String voiceName) {
            runOnUiThread(() -> {
                if (voiceName == null || voiceName.length() > 200) return;
                if (!selectedVoiceName.equals(voiceName) && onlineSpeech != null) onlineSpeech.cancelPreparation();
                selectedVoiceName = voiceName;
                applySelectedVoice();
            });
        }

        @JavascriptInterface
        public void installChineseVoice() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
                } catch (Exception ignored) {
                    startActivity(new Intent(Settings.ACTION_SETTINGS));
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript("(() => { const mode = document.body.dataset.mode; "
                + "if (window.AppUpdateUI && window.AppUpdateUI.back()) return 'updates'; "
                + "if ((mode === 'sound' || mode === 'train') && window.ListeningGames && window.ListeningGames.back()) return 'listening'; "
                + "if (mode === 'attention' && window.AttentionCards && window.AttentionCards.back()) return 'attention'; "
                + "if (mode === 'poetry' && window.TangPoetryUI && window.TangPoetryUI.back()) return 'poetry'; "
                + "if (mode === 'pattern' && window.PatternLearningUI && window.PatternLearningUI.back()) return 'help'; "
                + "if (mode === 'shadow' && window.ShadowMatchingUI && window.ShadowMatchingUI.back()) return 'help'; "
                + "if (mode === 'count' && window.NumberLearningUI && window.NumberLearningUI.back()) return 'lesson'; "
                + "if (mode === 'cipher' && document.getElementById('cipherScreen').classList.contains('answer-open')) "
                + "{ document.getElementById('answerViewBack').click(); return 'answer'; } "
                + "if (mode === 'home') return 'exit'; window.location.hash = 'home'; return 'home'; })()", value -> {
            if ("\"exit\"".equals(value) || "null".equals(value)) super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        if (appUpdates != null) appUpdates.onPause();
        pendingText = null;
        if (onlineSpeech != null) { onlineSpeech.stop(); onlineSpeech.cancelPreparation(); }
        if (textToSpeech != null) textToSpeech.stop();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (onlineSpeech != null) onlineSpeech.close();
        if (appUpdates != null) appUpdates.close();
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
        }
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidTts");
            webView.removeJavascriptInterface("AppUpdates");
            webView.destroy();
        }
        super.onDestroy();
    }
}
