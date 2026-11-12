package com.comeend.tongyeok;

import android.content.Context;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executor;

/** Claude 로 번역한 문구를 기억해 같은 글자를 다시 보내지 않는다 (최대 3000개, 파일에 저장). */
final class TranslationCache {
    private static final int MAX = 3000;
    private final File file;
    private final LinkedHashMap<String, String> map = new LinkedHashMap<String, String>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) { return size() > MAX; }
    };
    private boolean saveQueued;

    TranslationCache(Context c) {
        file = new File(c.getFilesDir(), "translations.json");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] b = new byte[(int) file.length()];
            int off = 0, n;
            while (off < b.length && (n = in.read(b, off, b.length - off)) > 0) off += n;
            JSONObject o = new JSONObject(new String(b, 0, off, StandardCharsets.UTF_8));
            Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                map.put(k, o.optString(k));
            }
        } catch (Exception ignored) {
            // 처음 실행이거나 파일이 깨졌으면 빈 캐시로 시작
        }
    }

    synchronized String get(String zh) { return map.get(zh); }

    synchronized void put(String zh, String ko) { map.put(zh, ko); }

    void saveLater(Executor executor) {
        synchronized (this) {
            if (saveQueued) return;
            saveQueued = true;
        }
        executor.execute(this::save);
    }

    void save() {
        String json;
        synchronized (this) {
            saveQueued = false;
            json = new JSONObject(map).toString();
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) { }
    }

    synchronized void clear() {
        map.clear();
        file.delete();
    }
}
