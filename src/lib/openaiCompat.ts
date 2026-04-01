/**
 * 新しいフォルダー/lib/openaiStream.ts と同じ OpenAI 互換 API 設定
 * （ベース URL・モデル優先順・リトライ後も失敗なら次モデルへ）
 */

import {
  fetchWithRetry,
  humanizeHttpError,
  humanizeNetworkError,
  isRetryableHttpStatus,
} from "@/lib/httpRetry";
import { formatOpenAiCompatibleErrorForHuman } from "@/lib/openaiErrorParse";
import {
  logOpenAiTokenUsage,
  type NormalizedTokenUsage,
} from "@/lib/openaiUsage";

export const OPENAI_MODELS = [
  "gemini-flash-latest",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
] as const;

/** MediaWiki 記事（wikitext）生成のみ先頭で試す（失敗時は OPENAI_MODELS と同じ順でフォールバック） */
export const WIKI_COMPOSE_MODELS = [
  "gemini-3.1-pro-preview",
  ...OPENAI_MODELS,
] as const;

/** 同一モデルでのリトライ後も解決しなければ次モデルへ */
const MODEL_FALLBACK_STATUSES = new Set([429, 503, 500, 404]);

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionOptions = {
  temperature?: number;
  /** true のとき response_format json_object を付与（未対応なら外して再試行） */
  jsonObject?: boolean;
  /**
   * 試行するモデル順。未指定時は OPENAI_MODELS。
   * 環境変数 OPENAI_MODEL が単体指定されているときは常にそちらが優先される。
   */
  models?: readonly string[];
};

function apiBase(): string {
  const b = process.env.OPENAI_API_BASE?.trim();
  if (!b) {
    throw new Error(
      "OPENAI_API_BASE が未設定です。.env.local に OpenAI 互換 API のベース URL（例: https://api.openai.com/v1）を設定してください。",
    );
  }
  return b.replace(/\/$/, "");
}

/** 1 回の chat/completions HTTP（非ストリーム全体・ストリームの初回応答）の打ち切り */
export function openAiFetchTimeoutMs(): number {
  const raw = process.env.HIKAMER_OPENAI_FETCH_TIMEOUT_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 5000) return n;
  }
  return 300_000;
}

/**
 * SSE 本文の読み取り全体の上限（0 または未設定で無制限）。
 * 長文生成で打ち切られたくない場合は大きくするか 0。
 */
function openAiStreamMaxReadMs(): number {
  const raw = process.env.HIKAMER_OPENAI_STREAM_MAX_MS?.trim();
  if (raw === "0" || raw === "") return 0;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 5000) return n;
  }
  return 0;
}

function aiHttpRetryOptions() {
  return {
    maxAttempts: 4 as const,
    retryOnStatus: isRetryableHttpStatus,
    timeoutMs: openAiFetchTimeoutMs(),
  };
}

/** SSE 最終チャンクに usage を載せる（OpenAI 互換 `stream_options.include_usage`）。`0` で送らない */
function streamRequestsIncludeUsage(): boolean {
  return process.env.HIKAMER_OPENAI_STREAM_INCLUDE_USAGE?.trim() !== "0";
}

function buildErrorFromAiResponse(status: number, bodyText: string): string {
  const parsed =
    bodyText.trim().length > 0
      ? formatOpenAiCompatibleErrorForHuman(bodyText)
      : "";
  if (parsed) return parsed;
  return humanizeHttpError("openai", status, bodyText);
}

function modelsToTry(options: ChatCompletionOptions): string[] {
  const single = process.env.OPENAI_MODEL?.trim();
  if (single) return [single];
  if (options.models && options.models.length > 0) {
    return [...options.models];
  }
  return [...OPENAI_MODELS];
}

export async function chatCompletionNonStream(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {}
): Promise<{ content: string; model: string; usage: NormalizedTokenUsage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が設定されていません");
  }

  const temperature = options.temperature ?? 0.3;
  const models = modelsToTry(options);
  let lastError: Error | null = null;

  for (const model of models) {
    const tryModes = options.jsonObject ? [true, false] : [false];
    for (const useJson of tryModes) {
      try {
        const body: Record<string, unknown> = {
          model,
          messages,
          temperature,
          stream: false,
        };
        if (useJson) {
          body.response_format = { type: "json_object" };
        }
        const res = await fetchWithRetry(
          `${apiBase()}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          },
          aiHttpRetryOptions()
        );
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string | null } }>;
            usage?: unknown;
          };
          const content = data.choices?.[0]?.message?.content;
          const usage = logOpenAiTokenUsage(model, data.usage, "chat/completions");
          if (typeof content === "string" && content.length > 0) {
            return { content, model, usage };
          }
          lastError = new Error("AI から本文が返りませんでした");
          continue;
        }
        const errBody = await res.text();
        if (
          useJson &&
          options.jsonObject &&
          res.status === 400
        ) {
          lastError = new Error(`AI API 400 (json_object 未対応の可能性)`);
          continue;
        }
        if (MODEL_FALLBACK_STATUSES.has(res.status)) {
          lastError = new Error(
            buildErrorFromAiResponse(res.status, errBody)
          );
          break;
        }
        lastError = new Error(
          buildErrorFromAiResponse(res.status, errBody)
        );
        break;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          lastError = new Error(
            `AI API がタイムアウトしました（${openAiFetchTimeoutMs()}ms）。ゲートウェイ無応答・極端に重い推論・コンテキスト過大の可能性があります。HIKAMER_OPENAI_FETCH_TIMEOUT_MS で待ち時間を調整できます。`
          );
          break;
        }
        lastError = new Error(
          e instanceof TypeError
            ? humanizeNetworkError("openai")
            : e instanceof Error
              ? e.message
              : String(e)
        );
        break;
      }
    }
  }

  throw (
    lastError ??
    new Error("AI応答に失敗しました。しばらく待ってから再試行してください。")
  );
}

/** OpenAI 互換ストリームの delta から推論・本文を取り出す（ゲートウェイによってキー名が異なる） */
function extractStreamDeltas(delta: unknown): {
  content: string;
  reasoning: string;
} {
  if (!delta || typeof delta !== "object") return { content: "", reasoning: "" };
  const d = delta as Record<string, unknown>;
  let reasoning = "";
  for (const k of [
    "reasoning_content",
    "reasoning",
    "thinking",
    "thought",
  ] as const) {
    const v = d[k];
    if (typeof v === "string" && v.length > 0) reasoning += v;
  }
  const c = d.content;
  const content =
    typeof c === "string" && c.length > 0 ? c : "";
  return { content, reasoning };
}

async function readOpenAiSseBody(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onReasoningDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<{ content: string; usage: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let lastUsage: unknown;
  const handleLine = (raw: string) => {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith("data: ")) return;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") return;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: Record<string, unknown> }>;
        usage?: unknown;
      };
      if (json.usage != null) {
        lastUsage = json.usage;
      }
      const rawDelta = json.choices?.[0]?.delta;
      const { content, reasoning } = extractStreamDeltas(rawDelta);
      if (reasoning.length > 0 && onReasoningDelta) {
        onReasoningDelta(reasoning);
      }
      if (content.length > 0) {
        full += content;
        onDelta(content);
      }
    } catch {
      /* */
    }
  };
  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    }
    if (buffer.length > 0) handleLine(buffer);
    return { content: full, usage: lastUsage };
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* */
    }
  }
}

/**
 * OpenAI 互換のストリーミング（SSE）。全文を返しつつ onDelta で断片を通知。
 */
export async function chatCompletionStream(
  messages: ChatMessage[],
  options: ChatCompletionOptions & {
    onDelta: (text: string) => void;
    /** 推論・思考トークン（対応モデル / ゲートウェイのみ） */
    onReasoningDelta?: (text: string) => void;
  }
): Promise<{ content: string; model: string; usage: NormalizedTokenUsage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が設定されていません");
  }

  const temperature = options.temperature ?? 0.3;
  const models = modelsToTry(options);
  let lastError: Error | null = null;

  for (const model of models) {
    const tryModes = options.jsonObject ? [true, false] : [false];
    for (const useJson of tryModes) {
      try {
        const body: Record<string, unknown> = {
          model,
          messages,
          temperature,
          stream: true,
        };
        if (streamRequestsIncludeUsage()) {
          body.stream_options = { include_usage: true };
        }
        if (useJson) {
          body.response_format = { type: "json_object" };
        }
        const res = await fetchWithRetry(
          `${apiBase()}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          },
          aiHttpRetryOptions()
        );
        if (!res.ok) {
          const errBody = await res.text();
          if (
            useJson &&
            options.jsonObject &&
            res.status === 400
          ) {
            lastError = new Error(`AI API 400 (json_object 未対応の可能性)`);
            continue;
          }
          if (MODEL_FALLBACK_STATUSES.has(res.status)) {
            lastError = new Error(
              buildErrorFromAiResponse(res.status, errBody)
            );
            break;
          }
          lastError = new Error(
            buildErrorFromAiResponse(res.status, errBody)
          );
          break;
        }
        if (!res.body) {
          lastError = new Error("AI 応答ボディがありません");
          continue;
        }
        const streamMax = openAiStreamMaxReadMs();
        const sseSignal =
          streamMax > 0 ? AbortSignal.timeout(streamMax) : undefined;
        const { content, usage } = await readOpenAiSseBody(
          res.body,
          options.onDelta,
          options.onReasoningDelta,
          sseSignal
        );
        const usageNorm = logOpenAiTokenUsage(
          model,
          usage,
          "chat/completions stream"
        );
        if (typeof content === "string" && content.length > 0) {
          return { content, model, usage: usageNorm };
        }
        lastError = new Error("AI から本文が返りませんでした");
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          const sm = openAiStreamMaxReadMs();
          lastError = new Error(
            sm > 0
              ? `AI がタイムアウトしました（HTTP 接続 ${openAiFetchTimeoutMs()}ms または SSE 読み取り ${sm}ms のいずれかで打ち切り）。ゲートウェイ無応答・長文生成・コンテキスト過大の可能性があります。HIKAMER_OPENAI_FETCH_TIMEOUT_MS / HIKAMER_OPENAI_STREAM_MAX_MS を調整してください。`
              : `AI API がタイムアウトしました（${openAiFetchTimeoutMs()}ms）。ゲートウェイ無応答・極端に重い推論・コンテキスト過大の可能性があります。HIKAMER_OPENAI_FETCH_TIMEOUT_MS で待ち時間を調整できます。`
          );
          break;
        }
        lastError = new Error(
          e instanceof TypeError
            ? humanizeNetworkError("openai")
            : e instanceof Error
              ? e.message
              : String(e)
        );
        break;
      }
    }
  }

  throw (
    lastError ??
    new Error("AI応答に失敗しました。しばらく待ってから再試行してください。")
  );
}
