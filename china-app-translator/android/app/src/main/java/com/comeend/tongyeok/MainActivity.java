package com.comeend.tongyeok;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * assets/index.html (웹과 같은 화면)을 WebView 로 띄우고,
 * AI 번역(사용자 API 키), 중국어 음성, 공유받은 스크린샷을 네이티브로 처리한다.
 */
public class MainActivity extends Activity {
    private static final int REQ_PICK_IMAGE = 1;
    private static final int REQ_CAPTURE = 2;
    private static final int REQ_NOTIFY = 3;
    private static final String PREFS = "tongyeok";
    private static final String KEY_API = "anthropic_api_key";
    private static final int MAX_SIDE = 1600;

    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private ValueCallback<Uri[]> fileCallback;
    private TextToSpeech tts;
    private boolean ttsReady;
    private boolean pageReady;
    private Intent pendingShare;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.addJavascriptInterface(new Bridge(), "TongyeokApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) {
                    openExternal(uri);   // 파파고, 콘솔 링크 등은 브라우저로
                    return true;
                }
                return false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, "스크린샷 선택"), REQ_PICK_IMAGE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                int r = tts.setLanguage(Locale.SIMPLIFIED_CHINESE);
                ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
                tts.setSpeechRate(0.85f);
            }
        });

        pendingShare = getIntent();
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingShare = intent;
        if (pageReady) deliverShare();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAPTURE) {
            if (resultCode == RESULT_OK && data != null) {
                Intent svc = new Intent(this, ScreenTranslateService.class)
                        .putExtra(ScreenTranslateService.EXTRA_RESULT_CODE, resultCode)
                        .putExtra(ScreenTranslateService.EXTRA_DATA, data);
                startForegroundService(svc);
                toast("자동 번역을 시작했어요. 중국 앱을 열어 보세요");
                moveTaskToBack(true);
            } else {
                toast("화면 녹화를 허용해야 자동 번역을 쓸 수 있어요");
            }
            return;
        }
        if (requestCode == REQ_PICK_IMAGE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("window.__back ? window.__back() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        io.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    // ---------- 공유 받기 ----------

    private void deliverShare() {
        Intent intent = pendingShare;
        pendingShare = null;
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType() == null ? "" : intent.getType();
        if (type.startsWith("image/")) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) return;
            io.execute(() -> {
                String b64 = loadJpegBase64(uri);
                if (b64 == null) {
                    main.post(() -> toast("이미지를 열 수 없어요"));
                    return;
                }
                js("window.__sharedImage && window.__sharedImage(" + JSONObject.quote("data:image/jpeg;base64," + b64) + ")");
            });
        } else {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null) js("window.__sharedText && window.__sharedText(" + JSONObject.quote(text.toString()) + ")");
        }
    }

    /** 공유된 이미지를 긴 변 1600px 이하 JPEG 로 줄여 base64 로 반환. */
    private String loadJpegBase64(Uri uri) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                BitmapFactory.decodeStream(in, null, bounds);
            }
            int side = Math.max(bounds.outWidth, bounds.outHeight);
            if (side <= 0) return null;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 1;
            while (side / (opts.inSampleSize * 2) >= MAX_SIDE) opts.inSampleSize *= 2;
            Bitmap bmp;
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                bmp = BitmapFactory.decodeStream(in, null, opts);
            }
            if (bmp == null) return null;
            int longSide = Math.max(bmp.getWidth(), bmp.getHeight());
            if (longSide > MAX_SIDE) {
                float k = (float) MAX_SIDE / longSide;
                Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.round(bmp.getWidth() * k), Math.round(bmp.getHeight() * k), true);
                if (scaled != bmp) bmp.recycle();
                bmp = scaled;
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, 85, out);
            bmp.recycle();
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        } catch (Exception | OutOfMemoryError e) {
            return null;
        }
    }

    // ---------- 도우미 ----------

    private void js(String code) {
        main.post(() -> web.evaluateJavascript(code, null));
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            toast("링크를 열 앱이 없어요");
        }
    }

    private void startAutoTranslate() {
        if (!Settings.canDrawOverlays(this)) {
            toast("먼저 '다른 앱 위에 표시'를 허용해 주세요");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.fromParts("package", getPackageName(), null)));
            } catch (ActivityNotFoundException ignored) { }
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
            return;   // 결과를 받은 뒤 이어서 진행
        }
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        try {
            startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE);
        } catch (ActivityNotFoundException e) {
            toast("이 기기에서는 화면 녹화를 쓸 수 없어요");
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFY) {
            // 알림을 거부해도 번역은 동작한다 (상단 알림만 안 보임)
            MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            try {
                startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE);
            } catch (ActivityNotFoundException ignored) { }
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 설정 화면에서 돌아오면 자동 번역 상태 다시 표시
        if (pageReady) web.evaluateJavascript("window.__autoRefresh && window.__autoRefresh()", null);
    }

    private ClaudeTranslator translator;
    private String translatorKey;

    /** 키가 바뀔 때만 HTTP 클라이언트를 새로 만든다. */
    private synchronized ClaudeTranslator translatorFor(String key) {
        if (translator == null || !key.equals(translatorKey)) {
            translator = new ClaudeTranslator(key);
            translatorKey = key;
        }
        return translator;
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /** 페이지 JS 에서 window.TongyeokApp 으로 호출된다 (WebView 바인더 스레드). */
    private final class Bridge {
        @JavascriptInterface
        public void pageReady() {
            main.post(() -> {
                pageReady = true;
                deliverShare();
            });
        }

        @JavascriptInterface
        public boolean hasKey() {
            return !prefs().getString(KEY_API, "").isEmpty();
        }

        @JavascriptInterface
        public void setKey(String key) {
            prefs().edit().putString(KEY_API, key == null ? "" : key.trim()).apply();
        }

        @JavascriptInterface
        public void ask(String id, String prompt, String jpegBase64, boolean quick) {
            String key = prefs().getString(KEY_API, "");
            io.execute(() -> {
                boolean ok;
                String text;
                if (key.isEmpty()) {
                    ok = false;
                    text = "먼저 Claude API 키를 저장해 주세요.";
                } else {
                    try {
                        text = translatorFor(key).ask(prompt, jpegBase64, quick);
                        ok = true;
                    } catch (ClaudeTranslator.UserFacingException e) {
                        ok = false;
                        text = e.getMessage();
                    } catch (Exception e) {
                        ok = false;
                        text = "번역하지 못했어요: " + e.getClass().getSimpleName();
                    }
                }
                js("window.__aiDone(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(text) + ")");
            });
        }

        /** {"overlay":다른 앱 위에 표시 허용, "running":자동 번역 실행 중, "ai":AI 번역 켜짐} */
        @JavascriptInterface
        public String autoStatus() {
            try {
                return new JSONObject()
                        .put("overlay", Settings.canDrawOverlays(MainActivity.this))
                        .put("running", ScreenTranslateService.isRunning())
                        .put("ai", prefs().getBoolean(ScreenTranslateService.KEY_AUTO_AI, false))
                        .toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setAutoAi(boolean on) {
            prefs().edit().putBoolean(ScreenTranslateService.KEY_AUTO_AI, on).apply();
        }

        @JavascriptInterface
        public void openOverlaySettings() {
            main.post(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.fromParts("package", getPackageName(), null)));
                } catch (ActivityNotFoundException e) {
                    toast("설정 → 애플리케이션 → 중국앱 통역노트 → 다른 앱 위에 표시 를 켜 주세요");
                }
            });
        }

        @JavascriptInterface
        public void startAuto() {
            main.post(MainActivity.this::startAutoTranslate);
        }

        @JavascriptInterface
        public void stopAuto() {
            main.post(() -> {
                ScreenTranslateService.stop(MainActivity.this);
                web.evaluateJavascript("window.__autoRefresh && window.__autoRefresh()", null);
            });
        }

        @JavascriptInterface
        public void speak(String text) {
            main.post(() -> {
                if (!ttsReady) {
                    toast("중국어 음성이 없어요. 설정 → 텍스트 음성 변환에서 중국어를 설치해 주세요.");
                    return;
                }
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "say");
            });
        }
    }
}
