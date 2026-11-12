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
     * @param prompt     지시문
     * @param jpegBase64 스크린샷(JPEG, base64). 텍스트만 번역할 때는 null
     * @param quick      짧은 문구 번역이면 true (낮은 effort)
     */
    public String ask(String prompt, String jpegBase64, boolean quick) throws UserFacingException {
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
                .maxTokens(16000L)
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
