package com.comeend.tongyeok;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.PermissionDeniedException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.errors.UnauthorizedException;
import com.anthropic.models.beta.messages.BetaBase64ImageSource;
import com.anthropic.models.beta.messages.BetaContentBlock;
import com.anthropic.models.beta.messages.BetaContentBlockParam;
import com.anthropic.models.beta.messages.BetaImageBlockParam;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaOutputConfig;
import com.anthropic.models.beta.messages.BetaStopReason;
import com.anthropic.models.beta.messages.BetaTextBlockParam;
import com.anthropic.models.beta.messages.MessageCreateParams;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Claude 호출만 담당하는 순수 Java 클래스 (Android 의존성 없음). 백그라운드 스레드에서 호출할 것. */
public final class ClaudeTranslator {
    public static final String MODEL = "claude-opus-5-5";
    /** 자동 번역 라벨용 "빠르게" 선택지 */
    public static final String FAST_MODEL = "claude-haiku-5-5";

    /** 화면에 그대로 보여줄 한국어 메시지를 담은 예외. */
    public static final class UserFacingException extends Exception {
        public UserFacingException(String message) { super(message); }
    }

    private final AnthropicClient client;

    public ClaudeTranslator(String apiKey) {
        client = AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofMinutes(3))
                .maxRetries(2)
                .build();
    }

    /**
     * 화면에 보이는 짧은 중국어 문구들을 한 번에 번역한다. 결과는 입력과 같은 순서·같은 개수.
     * 못 받은 항목은 null.
     */
    public List<String> translateBatch(List<String> items, List<String> screen, boolean fast) throws UserFacingException {
        JSONArray in = new JSONArray();
        for (String it : items) in.put(it);
        StringBuilder ctx = new StringBuilder();
        for (String line : screen) {
            if (ctx.length() > 3000) break;
            ctx.append(line).append('\n');
        }
        String prompt = "중국 여행 중인 한국인이 보고 있는 중국 앱 화면이야. 화면 글자는 OCR 로 읽어서 가끔 틀린 글자가 섞여 있어.\n\n"
                + "<화면 전체 글자(위→아래)>\n" + ctx + "</화면 전체 글자>\n\n"
                + "위 화면 맥락을 참고해서, 아래 '번역할 항목'만 한국어로 옮겨.\n"
                + "- 이 화면이 어떤 앱의 어떤 화면인지 맥락에 맞는 뜻으로 (예: 배달 앱의 起送 → 최소주문)\n"
                + "- 버튼·메뉴·탭은 짧게 2~8자 (예: 提交订单 → 주문 제출, 去结算 → 결제하기)\n"
                + "- OCR 오타로 보이면 맥락상 맞는 말로 고쳐서 번역\n"
                + "- 금액·숫자·영문은 그대로, 가게·지명 고유명사는 한국어 발음(뜻)\n"
                + "- 의미 없는 조각이면 빈 문자열\n"
                + "- 설명 없이 JSON 만: {\"t\":[번역1, 번역2, ...]} 항목과 같은 개수·순서\n\n"
                + "번역할 항목:\n" + in.toString();
        String text = request(prompt, null, true, 4000L, fast ? FAST_MODEL : MODEL);
        List<String> out = new ArrayList<>();
        try {
            int a = text.indexOf('{'), b = text.lastIndexOf('}');
            JSONArray arr = new JSONObject(text.substring(a, b + 1)).getJSONArray("t");
            for (int i = 0; i < items.size(); i++) {
                out.add(i < arr.length() && !arr.isNull(i) ? arr.optString(i, null) : null);
            }
        } catch (Exception e) {
            throw new UserFacingException("번역 결과를 읽지 못했어요. 잠시 뒤 다시 시도할게요.");
        }
        return out;
    }

    /**
     * @param prompt     지시문
     * @param jpegBase64 스크린샷(JPEG, base64). 텍스트만 번역할 때는 null
     * @param quick      짧은 문구 번역이면 true (낮은 effort)
     */
    public String ask(String prompt, String jpegBase64, boolean quick) throws UserFacingException {
        return request(prompt, jpegBase64, quick, 16000L, MODEL);
    }

    private String request(String prompt, String jpegBase64, boolean quick, long maxTokens, String model) throws UserFacingException {
        List<BetaContentBlockParam> blocks = new ArrayList<>();
        if (jpegBase64 != null && !jpegBase64.isEmpty()) {
            blocks.add(BetaContentBlockParam.ofImage(BetaImageBlockParam.builder()
                    .source(BetaBase64ImageSource.builder()
                            .data(jpegBase64)
                            .mediaType(BetaBase64ImageSource.MediaType.IMAGE_JPEG)
                            .build())
                    .build()));
        }
        blocks.add(BetaContentBlockParam.ofText(BetaTextBlockParam.builder().text(prompt).build()));

        MessageCreateParams.Builder builder = MessageCreateParams.builder()
                .model(model)
                .maxTokens(maxTokens)
                .outputConfig(BetaOutputConfig.builder()
                        .effort(quick ? BetaOutputConfig.Effort.LOW : BetaOutputConfig.Effort.MEDIUM)
                        .build())
                .addUserMessageOfContentBlockParams(blocks);
        if (MODEL.equals(model)) {
            // Opus 거절 시 서버가 다른 모델로 이어서 답하게 함 (Haiku 는 미지원)
            builder.addBeta("server-side-fallback-2026-07-01").fallbacksDefault();
        }
        MessageCreateParams params = builder.build();

        BetaMessage message;
        try {
            message = client.beta().messages().create(params);
        } catch (UnauthorizedException e) {
            throw new UserFacingException("API 키가 올바르지 않아요. 설정에서 키를 다시 확인해 주세요.");
        } catch (PermissionDeniedException e) {
            throw new UserFacingException("이 API 키로는 사용할 수 없어요. 키의 권한과 결제 상태를 확인해 주세요.");
        } catch (RateLimitException e) {
            throw new UserFacingException("요청이 많아요. 잠시 뒤 다시 시도해 주세요.");
        } catch (AnthropicServiceException e) {
            throw new UserFacingException("번역 서버 오류예요 (" + e.statusCode() + "). 잠시 뒤 다시 시도해 주세요.");
        } catch (AnthropicIoException e) {
            throw new UserFacingException("인터넷에 연결할 수 없어요. 데이터나 로밍 상태를 확인해 주세요.");
        }

        if (message.stopReason().map(r -> r.equals(BetaStopReason.REFUSAL)).orElse(false)) {
            throw new UserFacingException("이 화면은 번역할 수 없다는 답이 왔어요. 다른 캡처로 시도해 주세요.");
        }
        StringBuilder out = new StringBuilder();
        for (BetaContentBlock block : message.content()) {
            block.text().ifPresent(t -> out.append(t.text()));
        }
        if (message.stopReason().map(r -> r.equals(BetaStopReason.MAX_TOKENS)).orElse(false)) {
            out.append("\n\n(답이 길어 중간에 끊겼어요)");
        }
        return out.toString();
    }
}
