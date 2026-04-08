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

/** 空応答時に API が返したシグナルを集める（finish_reason / blockReason / error 等） */
export type AiCompletionDiagnostics = {
  finishReasons: string[];
  refusals: string[];
  geminiHints: string[];
  apiErrors: string[];
  /** 各 SSE イベントから拾った短い要約（末尾数件） */
  payloadHints: string[];
  sseParseFailures: number;
  lastBadLineSnippet?: string;
  /** マージ前: assistant の content チャネルに積んだ文字数 */
  streamContentChars?: number;
  /** マージ前: reasoning 系チャネルに積んだ文字数 */
  streamReasoningChars?: number;
};

function createEmptyDiagnostics(): AiCompletionDiagnostics {
  return {
    finishReasons: [],
    refusals: [],
    geminiHints: [],
    apiErrors: [],
    payloadHints: [],
    sseParseFailures: 0,
  };
}

function pushUnique(arr: string[], v: string) {
  if (v && !arr.includes(v)) arr.push(v);
}

/**
 * OpenAI 互換 / Gemini 風の 1 レスポンス JSON から、空応答の原因調査用フィールドを取り出す。
 */
function mergeDiagnosticsFromJson(
  json: unknown,
  acc: AiCompletionDiagnostics
): void {
  if (!json || typeof json !== "object") return;
  const j = json as Record<string, unknown>;

  if (j.error && typeof j.error === "object") {
    const e = j.error as Record<string, unknown>;
    const parts = [e.message, e.code, e.type, e.param]
      .filter((x) => typeof x === "string" && String(x).trim())
      .map(String);
    if (parts.length) pushUnique(acc.apiErrors, parts.join(" "));
  }

  const rootPf = j.promptFeedback;
  if (rootPf && typeof rootPf === "object") {
    const br = (rootPf as Record<string, unknown>).blockReason;
    if (typeof br === "string" && br.trim()) {
      pushUnique(acc.geminiHints, `promptFeedback.blockReason=${br.trim()}`);
    }
  }

  const ch0 = Array.isArray(j.choices) ? j.choices[0] : undefined;
  if (ch0 && typeof ch0 === "object") {
    const c = ch0 as Record<string, unknown>;
    if (typeof c.finish_reason === "string" && c.finish_reason.trim()) {
      pushUnique(acc.finishReasons, c.finish_reason.trim());
    }
    const delta = c.delta;
    if (delta && typeof delta === "object") {
      const dr = (delta as Record<string, unknown>).refusal;
      if (typeof dr === "string" && dr.trim()) {
        pushUnique(acc.refusals, dr.trim().slice(0, 500));
      }
    }
    const msg = c.message;
    if (msg && typeof msg === "object") {
      const mr = (msg as Record<string, unknown>).refusal;
      if (typeof mr === "string" && mr.trim()) {
        pushUnique(acc.refusals, mr.trim().slice(0, 500));
      }
    }
  }

  const cands = j.candidates;
  if (Array.isArray(cands) && cands[0] && typeof cands[0] === "object") {
    const c0 = cands[0] as Record<string, unknown>;
    for (const key of ["finishReason", "blockReason", "finish_reason"] as const) {
      const v = c0[key];
      if (typeof v === "string" && v.trim()) {
        pushUnique(acc.geminiHints, `${key}=${v.trim()}`);
      }
    }
    const pf = c0.promptFeedback;
    if (pf && typeof pf === "object") {
      const br = (pf as Record<string, unknown>).blockReason;
      if (typeof br === "string" && br.trim()) {
        pushUnique(acc.geminiHints, `cand.promptFeedback.blockReason=${br.trim()}`);
      }
    }
    const sr = c0.safetyRatings;
    if (Array.isArray(sr)) {
      for (const item of sr) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const prob = o.probability;
        if (
          prob === "HIGH" ||
          prob === "MEDIUM" ||
          prob === "high" ||
          prob === "medium"
        ) {
          const cat = o.category ?? o.categoryRaw ?? "?";
          pushUnique(acc.geminiHints, `safetyRatings.${String(cat)}=${String(prob)}`);
        }
      }
    }
  }

  const parts: string[] = [];
  if (j.usage != null) parts.push("usage");
  if (Array.isArray(j.choices)) parts.push(`choices=${j.choices.length}`);
  if (Array.isArray(j.candidates)) parts.push(`candidates=${j.candidates.length}`);
  if (j.error != null) parts.push("error");
  const hint = parts.join(",");
  if (hint) {
    acc.payloadHints.push(hint);
    if (acc.payloadHints.length > 8) acc.payloadHints.shift();
  }
}

function formatDiagnosticsForLog(d: AiCompletionDiagnostics): string {
  try {
    return JSON.stringify(d);
  } catch {
    return "(diagnostics serialize failed)";
  }
}

function formatDiagnosticsForHumanMessage(d: AiCompletionDiagnostics): string {
  const bits: string[] = [];
  if (d.apiErrors.length) bits.push(`APIエラー: ${d.apiErrors.join("; ")}`);
  if (d.finishReasons.length) bits.push(`finish_reason=${d.finishReasons.join(",")}`);
  if (d.refusals.length) bits.push(`refusal=${d.refusals[0]!.slice(0, 200)}`);
  if (d.geminiHints.length) bits.push(d.geminiHints.join("; "));
  if (
    d.streamContentChars != null ||
    d.streamReasoningChars != null
  ) {
    bits.push(
      `受信デルタ文字数 content=${d.streamContentChars ?? 0} reasoning=${d.streamReasoningChars ?? 0}`
    );
  }
  if (d.payloadHints.length) {
    bits.push(`SSEイベント要約: …${d.payloadHints.slice(-3).join(" | ")}`);
  }
  if (d.sseParseFailures > 0) {
    bits.push(
      `SSE_JSONパース失敗=${d.sseParseFailures}回` +
        (d.lastBadLineSnippet ? ` 行頭=${d.lastBadLineSnippet.slice(0, 120)}` : "")
    );
  }
  return bits.length > 0 ? ` 詳細: ${bits.join(" / ")}` : "";
}

/**
 * finish_reason=stop なのに本文・推論デルタが 0・completion も 0 のときの説明（ブロック明示なし）
 */
function explainStopWithNoTextDeltas(
  usage: NormalizedTokenUsage,
  d: AiCompletionDiagnostics
): string | null {
  const out = usage.outputTokens;
  if (out != null && out > 0) return null;
  if (!d.finishReasons.includes("stop")) return null;
  if ((d.streamContentChars ?? 0) > 0 || (d.streamReasoningChars ?? 0) > 0) {
    return null;
  }
  if (d.apiErrors.length > 0 || d.refusals.length > 0 || d.geminiHints.length > 0) {
    return null;
  }
  return (
    " 判定メモ: API は finish_reason=stop で終了したが、content/reasoning いずれのデルタも 0 文字・completion_tokens=0。" +
    " blockReason / refusal / error は検出されず（コンテンツフィルターの明示ブロックとは限らない）。" +
    " ゲートウェイが空チャンクのみ送って終了した挙動の可能性あり。"
  );
}

/** 入力が極大のときの切り分けヒント（断定はしない） */
function largePromptCorrelationNote(usage: NormalizedTokenUsage): string {
  const pt = usage.inputTokens;
  if (pt == null || pt < 550_000) return "";
  return (
    " 参考: 入力が約 55 万トークン超。" +
    " **同じゲートウェイで、より小さいプロンプトでは成功し、大きいとこの空応答になる**なら、実効コンテキスト・ゲートウェイ実装・モデル側のいずれかの閾値の切り分け材料になる（ログ上は blockReason なし）。"
  );
}

/** 本文ゼロ・usage だけ返るとき（診断情報があればエラー文に含める） */
function messageForEmptyCompletion(
  usage: NormalizedTokenUsage,
  diagnostics?: AiCompletionDiagnostics
): string {
  const pt = usage.inputTokens;
  const base =
    pt != null && pt >= 150_000
      ? `AI から本文が返りませんでした（入力約 ${pt.toLocaleString("en-US")} トークン・出力 0）。`
      : "AI から本文が返りませんでした（出力 0）。";
  const detail = diagnostics ? formatDiagnosticsForHumanMessage(diagnostics) : "";
  const stopNo =
    diagnostics != null ? explainStopWithNoTextDeltas(usage, diagnostics) : null;
  return base + detail + (stopNo ?? "") + largePromptCorrelationNote(usage);
}

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

/**
 * MediaWiki 記事（wikitext）生成。先頭は 3.1 Pro → flash-latest → 3 flash → 2.5 pro → 3.1 flash lite、以降は軽量 flash 系へフォールバック。
 */
export const WIKI_COMPOSE_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
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
  /**
   * `fetch` 直前（応答ヘッダが返るまで長いときがある）。
   */
  onAwaitingHttpResponse?: () => void;
  /**
   * HTTP 200 かつ本文の読み取り開始直前（ストリームなら SSE、非ストリームなら JSON パース前）。
   */
  onHttpResponseReady?: () => void;
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

  options.onAwaitingHttpResponse?.();

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
          options.onHttpResponseReady?.();
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: unknown } }>;
            usage?: unknown;
          };
          const raw = data.choices?.[0]?.message?.content;
          const content =
            typeof raw === "string"
              ? raw
              : stringFromContentField(raw);
          const usage = logOpenAiTokenUsage(model, data.usage, "chat/completions");
          if (typeof content === "string" && content.length > 0) {
            return { content, model, usage };
          }
          const diag = createEmptyDiagnostics();
          mergeDiagnosticsFromJson(data, diag);
          console.error(
            `[hikamer][openai] non-stream model=${model} empty message; diagnostics=${formatDiagnosticsForLog(diag)}`
          );
          lastError = new Error(messageForEmptyCompletion(usage, diag));
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

/** Gemini / 一部ゲートウェイは `content` が文字列以外（配列・{text}）になる */
function stringFromContentField(c: unknown): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    let s = "";
    for (const part of c) {
      if (typeof part === "string") s += part;
      else if (part && typeof part === "object") {
        const p = part as Record<string, unknown>;
        if (typeof p.text === "string") s += p.text;
        if (typeof p.content === "string") s += p.content;
      }
    }
    return s;
  }
  if (typeof c === "object") {
    const o = c as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
  }
  return "";
}

function appendReasoningFromField(reasoning: string, v: unknown): string {
  let out = reasoning;
  if (typeof v === "string" && v.length > 0) return out + v;
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === "string") out += x;
      else if (x && typeof x === "object") {
        const t = (x as Record<string, unknown>).text;
        if (typeof t === "string") out += t;
      }
    }
  }
  return out;
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
    reasoning = appendReasoningFromField(reasoning, d[k]);
  }
  let content = stringFromContentField(d.content);
  // 一部プロキシ・互換 API は OpenAI 標準の delta.content ではなく text / output_text を流す
  if (!content) {
    for (const k of ["text", "output_text"] as const) {
      const v = d[k];
      if (typeof v === "string" && v.length > 0) {
        content = v;
        break;
      }
    }
  }
  return { content, reasoning };
}

/**
 * SSE の 1 イベント JSON から assistant 文字列を集める。
 * `choices[0].delta` 以外に `choices[0].message` や Gemini 風 `candidates[].content.parts` があるゲートウェイ向け。
 */
function extractFromSseEventJson(json: unknown): {
  content: string;
  reasoning: string;
} {
  if (!json || typeof json !== "object") {
    return { content: "", reasoning: "" };
  }
  const j = json as Record<string, unknown>;
  let content = "";
  let reasoning = "";

  const choice0 = Array.isArray(j.choices) ? j.choices[0] : undefined;
  if (choice0 && typeof choice0 === "object") {
    const ch = choice0 as Record<string, unknown>;
    if (ch.delta) {
      const dr = extractStreamDeltas(ch.delta);
      content += dr.content;
      reasoning += dr.reasoning;
    }
    if (ch.message && typeof ch.message === "object") {
      const m = ch.message as Record<string, unknown>;
      content += stringFromContentField(m.content);
      if (typeof m.text === "string") content += m.text;
      if (m.reasoning_content) {
        reasoning = appendReasoningFromField(reasoning, m.reasoning_content);
      }
    }
  }

  const cands = j.candidates;
  if (Array.isArray(cands) && cands[0] && typeof cands[0] === "object") {
    const c0 = cands[0] as Record<string, unknown>;
    const cont = c0.content;
    if (cont && typeof cont === "object") {
      const parts = (cont as Record<string, unknown>).parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (p && typeof p === "object") {
            const t = (p as Record<string, unknown>).text;
            if (typeof t === "string") content += t;
          }
        }
      }
    }
    const r = c0.reasoning;
    if (typeof r === "string") reasoning += r;
  }

  return { content, reasoning };
}

export async function readOpenAiSseBody(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onReasoningDelta?: (text: string) => void,
  signal?: AbortSignal
): Promise<{
  content: string;
  usage: unknown;
  diagnostics: AiCompletionDiagnostics;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  /** Gemini 等が JSON を content ではなく reasoning 系チャネルだけに流すときがある */
  let fullReasoning = "";
  let lastUsage: unknown;
  const diagnostics = createEmptyDiagnostics();
  const handleLine = (raw: string) => {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith("data: ")) return;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") return;
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{
          delta?: Record<string, unknown>;
          message?: Record<string, unknown>;
        }>;
        candidates?: unknown[];
        usage?: unknown;
      };
      mergeDiagnosticsFromJson(json, diagnostics);
      if (json.usage != null) {
        lastUsage = json.usage;
      }
      const { content, reasoning } = extractFromSseEventJson(json);
      if (reasoning.length > 0) {
        fullReasoning += reasoning;
        onReasoningDelta?.(reasoning);
      }
      if (content.length > 0) {
        full += content;
        onDelta(content);
      }
    } catch {
      diagnostics.sseParseFailures++;
      if (!diagnostics.lastBadLineSnippet && line.length > 0) {
        diagnostics.lastBadLineSnippet = line.slice(0, 500);
      }
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
    const trimmed = full.trim();
    const trimmedReason = fullReasoning.trim();
    const merged =
      trimmed.length > 0
        ? full
        : trimmedReason.length > 0
          ? fullReasoning
          : full;
    if (trimmed.length === 0 && trimmedReason.length > 0) {
      console.log(
        "[hikamer][openai] SSE: content delta was empty; using reasoning_* channel as text (some Gemini gateways stream JSON only there)"
      );
    }
    diagnostics.streamContentChars = full.length;
    diagnostics.streamReasoningChars = fullReasoning.length;
    return { content: merged, usage: lastUsage, diagnostics };
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

  options.onAwaitingHttpResponse?.();

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
        options.onHttpResponseReady?.();
        const streamMax = openAiStreamMaxReadMs();
        const sseSignal =
          streamMax > 0 ? AbortSignal.timeout(streamMax) : undefined;
        const { content, usage, diagnostics } = await readOpenAiSseBody(
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
        console.error(
          `[hikamer][openai] stream model=${model} empty after SSE parse; usage=${JSON.stringify(usage)} diagnostics=${formatDiagnosticsForLog(diagnostics)}`
        );
        lastError = new Error(
          messageForEmptyCompletion(usageNorm, diagnostics)
        );
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
