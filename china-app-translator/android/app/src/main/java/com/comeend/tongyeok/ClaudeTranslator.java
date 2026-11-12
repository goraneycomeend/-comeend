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
    public List<String> translateBatch(List<String> items) throws UserFacingException {
        JSONArray in = new JSONArray();
        for (String it : items) in.put(it);
        String prompt = "중국 여행 중인 한국인이 보고 있는 중국 앱 화면의 글자들이야. 각 항목을 한국어로 짧게 번역해.\n"
                + "- 버튼·메뉴는 2~8자 정도의 자연스러운 한국어로 (예: 提交订单 → 주문 제출)\n"
                + "- 금액, 숫자, 영문, 이모지는 그대로 두기\n"
                + "- 고유명사(가게·지명)는 한국어 발음 표기 뒤에 괄호로 뜻 (예: 外滩 → 와이탄(번드))\n"
                + "- 설명 없이 JSON 만 출력: {\"t\":[번역1, 번역2, ...]} 입력과 같은 개수, 같은 순서\n\n"
                + "입력:\n" + in.toString();
        String text = request(prompt, null, true, 4000L);
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
        return request(prompt, jpegBase64, quick, 16000L);
    }

    private String request(String prompt, String jpegBase64, boolean quick, long maxTokens) throws UserFacingException {
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

        MessageCreateParams params = MessageCreateParams.builder()
                .model(MODEL)
                .maxTokens(maxTokens)
                .addBeta("server-side-fallback-2026-07-01")
                .fallbacksDefault()
                .outputConfig(BetaOutputConfig.builder()
                        .effort(quick ? BetaOutputConfig.Effort.LOW : BetaOutputConfig.Effort.MEDIUM)
                        .build())
                .addUserMessageOfContentBlockParams(blocks)
                .build();

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
