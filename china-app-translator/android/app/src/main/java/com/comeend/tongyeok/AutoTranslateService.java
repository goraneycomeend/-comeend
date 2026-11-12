package com.comeend.tongyeok;

import android.accessibilityservice.AccessibilityService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * 중국 앱이 앞에 떠 있는 동안 화면의 중국어 글자를 읽어, 그 자리에 한국어 라벨을 덮어 보여준다.
 * 1) 앱 안의 용어집(즉시, 무료)  2) 사용자가 켜면 Claude 로 나머지 글자 번역(캐시).
 * 라벨 창은 터치를 통과시키므로 원래 앱을 그대로 조작할 수 있다. 오른쪽의 "译" 버튼으로 라벨을 켜고 끈다.
 */
public class AutoTranslateService extends AccessibilityService {
    static final String PREFS = "tongyeok";
    static final String KEY_API = "anthropic_api_key";
    static final String KEY_AUTO_AI = "auto_ai";
    static final String KEY_LABELS_ON = "labels_on";
    static final String KEY_BUBBLE_Y = "bubble_y";

    /** 자동 번역 대상 앱 */
    static final Set<String> TARGETS = new HashSet<>(Arrays.asList(
            "com.tencent.mm",               // 위챗
            "com.eg.android.AlipayGphone",  // 알리페이
            "com.sankuai.meituan",          // 메이퇀
            "com.sankuai.meituan.takeoutnew", // 메이퇀 외卖
            "com.dianping.v1",              // 따종디엔핑
            "com.sdu.didi.psnger",          // 디디
            "com.autonavi.minimap",         // 가오더지도
            "me.ele",                       // 어러머
            "com.taobao.taobao",            // 타오바오
            "com.MobileTicket"              // 12306
    ));

    private static final Pattern HAN = Pattern.compile("[\\u3400-\\u9fff]");
    private static final int MAX_NODES = 500;
    private static final int MAX_TEXT = 80;
    private static final int MAX_BATCH = 40;
    private static final long DEBOUNCE_MS = 650;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private WindowManager wm;
    private LabelsView labels;
    private TextView bubble;
    private String currentPkg;
    private boolean labelsOn = true;
    private boolean requestInFlight;
    private long aiBlockedUntil;
    private final Set<String> pending = new HashSet<>();
    private ClaudeTranslator translator;
    private String translatorKey;
    private Glossary glossary;
    private TranslationCache cache;

    private final Runnable scanRunnable = this::scan;

    private static volatile AutoTranslateService running;

    static boolean isRunning() { return running != null; }

    @Override
    protected void onServiceConnected() {
        running = this;
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        glossary = Glossary.get(this);
        cache = new TranslationCache(this);
        labelsOn = prefs().getBoolean(KEY_LABELS_ON, true);
    }

    @Override
    public void onDestroy() {
        running = null;
        hideAll();
        io.shutdownNow();
        if (cache != null) cache.save();
        super.onDestroy();
    }

    @Override
    public void onInterrupt() { }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        CharSequence pkgCs = event.getPackageName();
        if (pkgCs == null) return;
        String pkg = pkgCs.toString();
        if (pkg.equals(getPackageName())) return;

        if (!TARGETS.contains(pkg)) {
            // 다른 앱(홈 화면 등)으로 넘어가면 숨김. 상단바·키보드는 무시.
            if (event.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                    && !pkg.equals("com.android.systemui") && !isKeyboard(pkg)) {
                currentPkg = null;
                main.removeCallbacks(scanRunnable);
                hideAll();
            }
            return;
        }

        if (!pkg.equals(currentPkg)) {
            currentPkg = pkg;
            showBubble();
        }
        int type = event.getEventType();
        if (type == AccessibilityEvent.TYPE_VIEW_SCROLLED || type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            if (labels != null) labels.setItems(new ArrayList<>());   // 위치가 바뀌었으니 일단 지움
        }
        main.removeCallbacks(scanRunnable);
        main.postDelayed(scanRunnable, DEBOUNCE_MS);
    }

    private boolean isKeyboard(String pkg) {
        String ime = Settings.Secure.getString(getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
        return ime != null && ime.startsWith(pkg + "/");
    }

    // ---------- 화면 읽기 ----------

    private static final class Item {
        final String zh;
        final Rect bounds;
        String ko;
        Item(String zh, Rect bounds) { this.zh = zh; this.bounds = bounds; }
    }

    private void scan() {
        if (currentPkg == null) return;
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        if (root.getPackageName() == null || !TARGETS.contains(root.getPackageName().toString())) return;

        List<Item> found = new ArrayList<>();
        collect(root, found, new int[]{0}, 0);

        boolean aiOn = prefs().getBoolean(KEY_AUTO_AI, false) && !apiKey().isEmpty();
        LinkedHashSet<String> unknown = new LinkedHashSet<>();
        List<Item> shown = new ArrayList<>();
        for (Item it : found) {
            String ko = glossary.lookup(it.zh);
            if (ko == null) ko = cache.get(it.zh);
            if (ko != null) {
                it.ko = ko;
                shown.add(it);
            } else if (aiOn && !pending.contains(it.zh)) {
                unknown.add(it.zh);
            }
        }
        if (labels == null) showLabels();
        labels.setItems(shown);
        updateBubble(shown.size(), !unknown.isEmpty() || requestInFlight);

        if (!unknown.isEmpty()) requestTranslations(new ArrayList<>(unknown));
    }

    private void collect(AccessibilityNodeInfo node, List<Item> out, int[] count, int depth) {
        if (node == null || depth > 60 || count[0] > MAX_NODES) return;
        count[0]++;
        if (!node.isVisibleToUser()) return;
        CharSequence cs = node.getText();
        if (TextUtils.isEmpty(cs) && node.isClickable()) cs = node.getContentDescription();
        if (!TextUtils.isEmpty(cs)) {
            String t = cs.toString().trim();
            if (t.length() <= MAX_TEXT && HAN.matcher(t).find()) {
                Rect r = new Rect();
                node.getBoundsInScreen(r);
                if (r.width() > 4 && r.height() > 4) out.add(new Item(t, r));
            }
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            collect(node.getChild(i), out, count, depth + 1);
        }
    }

    // ---------- Claude ----------

    private void requestTranslations(List<String> texts) {
        if (requestInFlight || System.currentTimeMillis() < aiBlockedUntil) return;
        String key = apiKey();
        if (key.isEmpty()) return;
        List<String> batch = texts.subList(0, Math.min(MAX_BATCH, texts.size()));
        List<String> copy = new ArrayList<>(batch);
        pending.addAll(copy);
        requestInFlight = true;
        io.execute(() -> {
            String error = null;
            List<String> result = null;
            try {
                result = translatorFor(key).translateBatch(copy);
            } catch (ClaudeTranslator.UserFacingException e) {
                error = e.getMessage();
            } catch (Exception e) {
                error = "자동 번역 오류: " + e.getClass().getSimpleName();
            }
            List<String> finalResult = result;
            String finalError = error;
            main.post(() -> {
                requestInFlight = false;
                pending.removeAll(copy);
                if (finalResult != null) {
                    for (int i = 0; i < copy.size(); i++) {
                        String ko = finalResult.get(i);
                        if (ko != null && !ko.isEmpty()) cache.put(copy.get(i), ko);
                    }
                    cache.saveLater(io);
                } else {
                    aiBlockedUntil = System.currentTimeMillis() + 30_000;  // 실패하면 30초 쉬기
                    Toast.makeText(this, finalError, Toast.LENGTH_LONG).show();
                }
                if (currentPkg != null) scan();
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

    // ---------- 화면 위에 그리기 ----------

    private void showLabels() {
        if (labels != null) return;
        labels = new LabelsView(this);
        labels.setVisibility(labelsOn ? View.VISIBLE : View.GONE);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        try { wm.addView(labels, lp); } catch (Exception e) { labels = null; }
    }

    private void showBubble() {
        if (bubble == null) {
            bubble = new TextView(this);
            bubble.setText("译");
            bubble.setTextColor(Color.WHITE);
            bubble.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
            bubble.setGravity(Gravity.CENTER);
            int size = dp(46);
            android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
            bg.setShape(android.graphics.drawable.GradientDrawable.OVAL);
            bubble.setBackground(bg);
            bubble.setElevation(dp(6));

            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(size, size,
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.END;
            lp.x = dp(6);
            lp.y = prefs().getInt(KEY_BUBBLE_Y, dp(220));
            bubble.setOnTouchListener(new BubbleTouch(lp));
            try { wm.addView(bubble, lp); } catch (Exception e) { bubble = null; return; }
        }
        bubble.setVisibility(View.VISIBLE);
        updateBubble(0, false);
    }

    private void updateBubble(int count, boolean working) {
        if (bubble == null) return;
        android.graphics.drawable.GradientDrawable bg = (android.graphics.drawable.GradientDrawable) bubble.getBackground();
        bg.setColor(labelsOn ? (working ? 0xF0B8322A : 0xF00D6B5F) : 0xC0606A68);
        bubble.setText(labelsOn ? "译" : "中");
        bubble.setContentDescription(labelsOn ? "번역 라벨 끄기" : "번역 라벨 켜기");
    }

    private void toggleLabels() {
        labelsOn = !labelsOn;
        prefs().edit().putBoolean(KEY_LABELS_ON, labelsOn).apply();
        if (labels != null) labels.setVisibility(labelsOn ? View.VISIBLE : View.GONE);
        updateBubble(0, requestInFlight);
        if (labelsOn) scan();
    }

    private void hideAll() {
        if (labels != null) { try { wm.removeView(labels); } catch (Exception ignored) { } labels = null; }
        if (bubble != null) bubble.setVisibility(View.GONE);
    }

    /** 탭: 라벨 켜기/끄기, 위아래로 끌기: 위치 옮기기, 길게 누르기: 통역노트 열기 */
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
                    if (moved) { lp.y = Math.max(0, startY + (int) dy); try { wm.updateViewLayout(v, lp); } catch (Exception ignored) { } }
                    return true;
                case MotionEvent.ACTION_UP:
                    if (moved) {
                        prefs().edit().putInt(KEY_BUBBLE_Y, lp.y).apply();
                    } else if (System.currentTimeMillis() - downAt > 600) {
                        Intent open = new Intent(AutoTranslateService.this, MainActivity.class);
                        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(open);
                    } else {
                        toggleLabels();
                    }
                    return true;
                default:
                    return false;
            }
        }
    }

    /** 각 중국어 글자 위에 한국어 라벨을 그리는 투명 뷰 */
    private final class LabelsView extends View {
        private List<Item> items = new ArrayList<>();
        private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint fg = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final int[] origin = new int[2];
        private final RectF box = new RectF();

        LabelsView(Context c) {
            super(c);
            bg.setColor(0xEB0D6B5F);
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
            float minSize = sp(9), maxSize = sp(14);
            float pad = dp(3);
            for (Item it : items) {
                float left = it.bounds.left - origin[0];
                float top = it.bounds.top - origin[1];
                float h = it.bounds.height();
                float size = Math.max(minSize, Math.min(maxSize, h * 0.55f));
                fg.setTextSize(size);
                float maxW = Math.max(it.bounds.width(), dp(140));
                maxW = Math.min(maxW, getWidth() - left - pad);
                String text = TextUtils.ellipsize(it.ko, new android.text.TextPaint(fg), maxW - pad * 2, TextUtils.TruncateAt.END).toString();
                float w = fg.measureText(text) + pad * 2;
                float boxH = size + pad * 2;
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
