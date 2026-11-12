package com.comeend.tongyeok;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;
import android.widget.Toast;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * 자동 번역 (접근성 권한 없이 동작).
 * 화면 녹화 권한으로 화면을 1초마다 살펴보다가, 화면이 바뀌고 멈추면 기기 안 OCR 로 중국어 줄을 찾아
 * 그 자리에 한국어 라벨을 그린다. 용어집 → 번역 캐시 → (사용자가 켠 경우) Claude 순으로 번역.
 * 라벨 창은 터치를 통과시킨다. 떠 있는 "译" 버튼: 탭=켜기/끄기, 끌기=이동, 길게=앱 열기.
 */
public class ScreenTranslateService extends Service {
    static final String PREFS = "tongyeok";
    static final String KEY_API = "anthropic_api_key";
    static final String KEY_AUTO_AI = "auto_ai";
    static final String KEY_BUBBLE_Y = "bubble_y";
    static final String EXTRA_RESULT_CODE = "resultCode";
    static final String EXTRA_DATA = "data";
    static final String ACTION_STOP = "com.comeend.tongyeok.STOP";

    private static final String CHANNEL = "auto";
    private static final int NOTIFICATION_ID = 7;
    private static final Pattern HAN = Pattern.compile("[\\u3400-\\u9fff]");
    private static final int MAX_TEXT = 60;
    private static final int MAX_BATCH = 40;
    private static final long TICK_MS = 900;
    private static final double CHANGE = 7.0;   // 화면이 바뀌었다고 볼 평균 밝기 차이 (0~255)
    private static final double STILL = 3.0;    // 멈췄다고 볼 차이

    private static volatile ScreenTranslateService running;

    static boolean isRunning() { return running != null; }

    static void stop(Context c) {
        ScreenTranslateService s = running;
        if (s != null) s.shutdown();
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private HandlerThread captureThread;
    private Handler capture;
    private WindowManager wm;
    private MediaProjection projection;
    private VirtualDisplay display;
    private ImageReader reader;
    private int width, height, dpi;
    private TextRecognizer recognizer;
    private Glossary glossary;
    private TranslationCache cache;

    private LabelsView labels;
    private TextView bubble;

    // 캡처 스레드에서만 쓰는 상태
    private enum State { OFF, SETTLING, SHOWING }
    private volatile State state = State.OFF;
    private int[] baseline;
    private int[] lastSig;
    private int settleTicks;

    // 메인 스레드에서만 쓰는 상태
    private List<Item> shown = new ArrayList<>();
    private final Set<String> pending = new HashSet<>();
    private boolean requestInFlight;
    private long aiBlockedUntil;
    private ClaudeTranslator translator;
    private String translatorKey;

    static final class Item {
        final String zh;
        final Rect bounds;
        String ko;
        Item(String zh, Rect bounds) { this.zh = zh; this.bounds = bounds; }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            return START_NOT_STICKY;
        }
        if (projection != null) {          // 이미 실행 중이면 켜기만
            setOn(true);
            return START_NOT_STICKY;
        }
        startAsForeground();

        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent data = intent.getParcelableExtra(EXTRA_DATA);
        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = mpm.getMediaProjection(resultCode, data);
        } catch (Exception e) {
            projection = null;
        }
        if (projection == null) {
            Toast.makeText(this, "화면 녹화 권한을 받지 못했어요", Toast.LENGTH_LONG).show();
            shutdown();
            return START_NOT_STICKY;
        }
        running = this;
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        glossary = Glossary.get(this);
        cache = new TranslationCache(this);
        recognizer = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());

        captureThread = new HandlerThread("tongyeok-capture");
        captureThread.start();
        capture = new Handler(captureThread.getLooper());

        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() { main.post(ScreenTranslateService.this::shutdown); }
        }, main);

        readMetrics();
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        try {
            display = projection.createVirtualDisplay("tongyeok", width, height, dpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.getSurface(), null, capture);
        } catch (Exception e) {
            Toast.makeText(this, "화면을 읽을 수 없어요: " + e.getClass().getSimpleName(), Toast.LENGTH_LONG).show();
            shutdown();
            return START_NOT_STICKY;
        }

        showLabelsWindow();
        showBubble();
        setOn(true);
        capture.postDelayed(tick, TICK_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    private boolean stopped;

    private void shutdown() {
        if (stopped) return;
        stopped = true;
        running = null;
        state = State.OFF;
        if (capture != null) capture.removeCallbacksAndMessages(null);
        try { if (display != null) display.release(); } catch (Exception ignored) { }
        try { if (projection != null) projection.stop(); } catch (Exception ignored) { }
        try { if (reader != null) reader.close(); } catch (Exception ignored) { }
        if (captureThread != null) captureThread.quitSafely();
        if (recognizer != null) recognizer.close();
        removeView(labels);
        removeView(bubble);
        labels = null;
        bubble = null;
        if (cache != null) cache.saveLater(io);
        io.shutdown();
        stopForeground(true);
        stopSelf();
    }

    private void removeView(View v) {
        if (v != null && wm != null) try { wm.removeView(v); } catch (Exception ignored) { }
    }

    // ---------- 포그라운드 알림 ----------

    private void startAsForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW));
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, ScreenTranslateService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent open = PendingIntent.getActivity(this, 2,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("중국어 자동 번역 중")
                .setContentText("译 버튼을 누르면 라벨을 끄고 켤 수 있어요")
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "번역 종료", stop).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    // ---------- 캡처 루프 (캡처 스레드) ----------

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            try {
                step();
            } catch (Exception ignored) {
                // 한 번 실패해도 계속
            }
            if (!stopped) capture.postDelayed(this, state == State.SETTLING ? 350 : TICK_MS);
        }
    };

    private void step() {
        if (state == State.OFF) return;
        checkRotation();
        Bitmap frame = latestFrame();
        if (frame == null) return;
        int[] sig = signature(frame);

        if (state == State.SHOWING) {
            frame.recycle();
            if (baseline == null) { baseline = sig; return; }
            if (diff(sig, baseline) > CHANGE) {
                // 스크롤 등으로 화면이 바뀜 → 라벨을 지우고 멈출 때까지 기다림
                state = State.SETTLING;
                lastSig = null;
                settleTicks = 0;
                main.post(() -> setLabels(new ArrayList<>()));
            }
            return;
        }

        // SETTLING: 라벨이 지워진 깨끗한 화면이 멈추면 OCR
        settleTicks++;
        boolean still = lastSig != null && diff(sig, lastSig) < STILL;
        lastSig = sig;
        if (!still && settleTicks < 8) { frame.recycle(); return; }

        List<Item> items = recognize(frame);
        frame.recycle();
        if (state != State.SETTLING) return;   // 그 사이 꺼졌으면 버림
        state = State.SHOWING;
        baseline = null;                       // 라벨이 그려진 다음 화면을 기준으로
        main.post(() -> onRecognized(items));
    }

    private Bitmap latestFrame() {
        Image image = reader.acquireLatestImage();
        if (image == null) return null;
        try {
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buf = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int w = image.getWidth(), h = image.getHeight();
            int padded = rowStride / pixelStride;
            Bitmap tmp = Bitmap.createBitmap(padded, h, Bitmap.Config.ARGB_8888);
            tmp.copyPixelsFromBuffer(buf);
            if (padded == w) return tmp;
            Bitmap cropped = Bitmap.createBitmap(tmp, 0, 0, w, h);
            tmp.recycle();
            return cropped;
        } finally {
            image.close();
        }
    }

    /** 화면을 27x48 흑백으로 줄인 지문. 상단 상태바(시계)는 뺀다. */
    private static int[] signature(Bitmap frame) {
        int top = frame.getHeight() / 20;
        Bitmap body = Bitmap.createBitmap(frame, 0, top, frame.getWidth(), frame.getHeight() - top);
        Bitmap small = Bitmap.createScaledBitmap(body, 27, 48, true);
        int[] px = new int[27 * 48];
        small.getPixels(px, 0, 27, 0, 0, 27, 48);
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            px[i] = (((c >> 16) & 255) * 3 + ((c >> 8) & 255) * 6 + (c & 255)) / 10;
        }
        if (body != frame) body.recycle();
        small.recycle();
        return px;
    }

    private static double diff(int[] a, int[] b) {
        long sum = 0;
        for (int i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
        return (double) sum / a.length;
    }

    private List<Item> recognize(Bitmap frame) {
        List<Item> out = new ArrayList<>();
        try {
            Text text = Tasks.await(recognizer.process(InputImage.fromBitmap(frame, 0)));
            for (Text.TextBlock block : text.getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    String t = line.getText().trim();
                    Rect r = line.getBoundingBox();
                    if (r == null || t.length() > MAX_TEXT || !HAN.matcher(t).find()) continue;
                    out.add(new Item(t, r));
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    private void checkRotation() {
        int oldW = width, oldH = height;
        readMetrics();
        if (oldW == width && oldH == height) return;
        ImageReader old = reader;
        reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        display.resize(width, height, dpi);
        display.setSurface(reader.getSurface());
        old.close();
        baseline = null;
        lastSig = null;
    }

    @SuppressWarnings("deprecation")
    private void readMetrics() {
        DisplayMetrics m = new DisplayMetrics();
        ((WindowManager) getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRealMetrics(m);
        width = m.widthPixels;
        height = m.heightPixels;
        dpi = m.densityDpi;
    }

    // ---------- 번역 (메인 스레드) ----------

    private void onRecognized(List<Item> items) {
        boolean aiOn = prefs().getBoolean(KEY_AUTO_AI, false) && !apiKey().isEmpty();
        LinkedHashSet<String> unknown = new LinkedHashSet<>();
        for (Item it : items) {
            it.ko = glossary.lookup(it.zh);
            if (it.ko == null) it.ko = cache.get(it.zh);
            if (it.ko == null && aiOn && !pending.contains(it.zh)) unknown.add(it.zh);
        }
        shown = items;
        setLabels(items);
        if (!unknown.isEmpty()) requestTranslations(new ArrayList<>(unknown));
    }

    private void requestTranslations(List<String> texts) {
        if (requestInFlight || System.currentTimeMillis() < aiBlockedUntil) return;
        String key = apiKey();
        if (key.isEmpty()) return;
        List<String> batch = new ArrayList<>(texts.subList(0, Math.min(MAX_BATCH, texts.size())));
        pending.addAll(batch);
        requestInFlight = true;
        updateBubble();
        io.execute(() -> {
            List<String> result = null;
            String error = null;
            try {
                result = translatorFor(key).translateBatch(batch);
            } catch (ClaudeTranslator.UserFacingException e) {
                error = e.getMessage();
            } catch (Exception e) {
                error = "자동 번역 오류: " + e.getClass().getSimpleName();
            }
            List<String> r = result;
            String err = error;
            main.post(() -> {
                requestInFlight = false;
                pending.removeAll(batch);
                if (r != null) {
                    for (int i = 0; i < batch.size(); i++) {
                        String ko = r.get(i);
                        if (ko != null && !ko.isEmpty()) cache.put(batch.get(i), ko);
                    }
                    if (!io.isShutdown()) cache.saveLater(io);
                    // 지금 보이는 라벨에 바로 반영
                    for (Item it : shown) if (it.ko == null) it.ko = cache.get(it.zh);
                    if (state == State.SHOWING) {
                        setLabels(shown);
                        capture.post(() -> baseline = null);   // 라벨이 늘어난 화면을 새 기준으로
                    }
                } else {
                    aiBlockedUntil = System.currentTimeMillis() + 30_000;
                    Toast.makeText(this, err, Toast.LENGTH_LONG).show();
                }
                updateBubble();
            });
        });
    }

    private synchronized ClaudeTranslator translatorFor(String key) {
        if (translator == null || !key.equals(translatorKey)) {
            translator = new ClaudeTranslator(key);
            translatorKey = key;
        }
        return translator;
    }

    // ---------- 켜기/끄기 ----------

    /** 상태 값은 캡처 스레드에서만 바꾼다. 라벨·버튼은 메인 스레드. */
    private void setOn(boolean on) {
        if (!on) setLabels(new ArrayList<>());
        capture.post(() -> {
            if (on) {
                lastSig = null;
                settleTicks = 0;
                state = State.SETTLING;
            } else {
                state = State.OFF;
            }
            main.post(this::updateBubble);
        });
    }

    // ---------- 화면 위 창 ----------

    private int overlayType() {
        return WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
    }

    private void showLabelsWindow() {
        labels = new LabelsView(this);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        if (Build.VERSION.SDK_INT >= 31) lp.alpha = 0.8f;   // Android 12+ 는 터치 통과 창의 불투명도를 0.8 이하로 요구
        try { wm.addView(labels, lp); } catch (Exception e) { labels = null; }
    }

    private void setLabels(List<Item> items) {
        if (labels == null) return;
        List<Item> visible = new ArrayList<>();
        for (Item it : items) if (it.ko != null) visible.add(it);
        labels.setItems(visible);
    }

    private void showBubble() {
        bubble = new TextView(this);
        bubble.setTextColor(Color.WHITE);
        bubble.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        bubble.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bubble.setBackground(bg);
        bubble.setElevation(dp(6));
        int size = dp(46);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(size, size, overlayType(),
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.END;
        lp.x = dp(6);
        lp.y = prefs().getInt(KEY_BUBBLE_Y, dp(220));
        bubble.setOnTouchListener(new BubbleTouch(lp));
        try { wm.addView(bubble, lp); } catch (Exception e) { bubble = null; }
        updateBubble();
    }

    private void updateBubble() {
        if (bubble == null) return;
        boolean on = state != State.OFF;
        ((GradientDrawable) bubble.getBackground()).setColor(on ? (requestInFlight ? 0xF0B8322A : 0xF00D6B5F) : 0xC0606A68);
        bubble.setText(on ? "译" : "中");
        bubble.setContentDescription(on ? "자동 번역 끄기" : "자동 번역 켜기");
    }

    /** 탭: 켜기/끄기, 위아래로 끌기: 이동, 길게 누르기: 통역노트 열기 */
    private final class BubbleTouch implements View.OnTouchListener {
        private final WindowManager.LayoutParams lp;
        private float downY;
        private int startY;
        private long downAt;
        private boolean moved;

        BubbleTouch(WindowManager.LayoutParams lp) { this.lp = lp; }

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downY = e.getRawY(); startY = lp.y; downAt = System.currentTimeMillis(); moved = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dy = e.getRawY() - downY;
                    if (Math.abs(dy) > dp(6)) moved = true;
                    if (moved) {
                        lp.y = Math.max(0, startY + (int) dy);
                        try { wm.updateViewLayout(v, lp); } catch (Exception ignored) { }
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (moved) {
                        prefs().edit().putInt(KEY_BUBBLE_Y, lp.y).apply();
                    } else if (System.currentTimeMillis() - downAt > 600) {
                        startActivity(new Intent(ScreenTranslateService.this, MainActivity.class)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    } else {
                        setOn(state == State.OFF);
                    }
                    return true;
                default:
                    return false;
            }
        }
    }

    /** 중국어 줄 위에 한국어 라벨을 그리는 투명 뷰 */
    private final class LabelsView extends View {
        private List<Item> items = new ArrayList<>();
        private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final TextPaint fg = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        private final int[] origin = new int[2];
        private final RectF box = new RectF();

        LabelsView(Context c) {
            super(c);
            bg.setColor(0xF20D6B5F);
            fg.setColor(Color.WHITE);
            fg.setFakeBoldText(true);
        }

        void setItems(List<Item> next) {
            items = next;
            invalidate();
        }

        @Override
        protected void onDraw(Canvas canvas) {
            getLocationOnScreen(origin);
            float minSize = sp(9), maxSize = sp(15), pad = dp(3);
            for (Item it : items) {
                float left = it.bounds.left - origin[0];
                float top = it.bounds.top - origin[1];
                float h = it.bounds.height();
                float size = Math.max(minSize, Math.min(maxSize, h * 0.7f));
                fg.setTextSize(size);
                float maxW = Math.max(it.bounds.width(), dp(120));
                maxW = Math.min(maxW, getWidth() - left - pad);
                if (maxW <= pad * 2) continue;
                String text = TextUtils.ellipsize(it.ko, fg, maxW - pad * 2, TextUtils.TruncateAt.END).toString();
                float w = Math.max(fg.measureText(text) + pad * 2, it.bounds.width());
                float boxH = Math.max(size + pad * 2, h);
                float cy = top + h / 2f;
                box.set(left, cy - boxH / 2f, left + w, cy + boxH / 2f);
                canvas.drawRoundRect(box, dp(4), dp(4), bg);
                canvas.drawText(text, left + pad, cy + size * 0.36f, fg);
            }
        }
    }

    // ---------- 도우미 ----------

    private SharedPreferences prefs() { return getSharedPreferences(PREFS, MODE_PRIVATE); }

    private String apiKey() { return prefs().getString(KEY_API, ""); }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private float sp(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, getResources().getDisplayMetrics());
    }
}
