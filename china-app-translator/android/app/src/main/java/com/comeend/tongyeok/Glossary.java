package com.comeend.tongyeok;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 앱 화면(assets/index.html)에 들어 있는 용어집을 그대로 읽어 자동 번역에 쓴다.
 * 용어집 원본은 index.html 의 T 배열 한 곳뿐이라 따로 맞출 필요가 없다.
 * 줄 형식: ["app","분류","中文","pinyin","한국어","팁?"],
 */
final class Glossary {
    private static final Pattern ROW = Pattern.compile(
            "\\[\"([a-z]+)\",\"[^\"]*\",\"([^\"]+)\",\"[^\"]*\",\"([^\"]+)\"");
    private static final Pattern EDGES = Pattern.compile("^([^\\u3400-\\u9fff]*)([\\u3400-\\u9fff]+)([^\\u3400-\\u9fff]*)$");
    private static Glossary instance;

    private final Map<String, String> map = new HashMap<>();

    static synchronized Glossary get(Context c) {
        if (instance == null) instance = new Glossary(c);
        return instance;
    }

    private Glossary(Context c) {
        try (InputStream in = c.getAssets().open("index.html")) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[16384];
            int n;
            while ((n = in.read(b)) > 0) buf.write(b, 0, n);
            Matcher m = ROW.matcher(new String(buf.toByteArray(), StandardCharsets.UTF_8));
            while (m.find()) {
                if (!map.containsKey(m.group(2))) map.put(m.group(2), m.group(3));
            }
        } catch (Exception ignored) {
            // 용어집이 없으면 AI 번역만 쓴다
        }
    }

    /** 화면 글자와 정확히 같은 용어가 있으면 한국어, 없으면 null */
    String lookup(String zh) {
        String k = zh.trim();
        String v = map.get(k);
        if (v != null) return v;
        // 끝의 문장부호·화살표 정도는 무시
        String stripped = k.replaceAll("[\\s>›»。！!？?：:，,]+$", "");
        if (!stripped.equals(k) && (v = map.get(stripped)) != null) return v;
        // 앞뒤의 숫자·금액·기호는 그대로 두고 가운데 용어만 번역 (예: 配送费¥3 → 배달비 ¥3)
        Matcher m = EDGES.matcher(k);
        if (m.matches() && (v = map.get(m.group(2))) != null) {
            return (m.group(1).isEmpty() ? "" : m.group(1).trim() + " ") + v
                    + (m.group(3).isEmpty() ? "" : " " + m.group(3).trim());
        }
        return null;
    }

    int size() { return map.size(); }
}
