/**
 * OpenAI 互換 / Gemini ゲートウェイが返す HTTP エラー JSON を読み、
 * コンテキスト超過・安全規制・レート制限などを日本語で区別しやすくする。
 */

/** 当ゲートウェイ／モデルで「コンテキスト超過」になりやすい入力トークン目安（2^20） */
export const HIKAMER_CONTEXT_TOKEN_SOFT_LIMIT = 1_048_576;

export type AiApiErrorKind =
  | "context"
  | "safety"
  | "rate"
  | "invalid_request"
  | "unknown";

export type ParsedAiApiError = {
  kind: AiApiErrorKind;
  /** API が返した主メッセージ（あれば） */
  message: string;
  /** 生の code / type など */
  codeHint: string;
};

function extractNestedMessage(obj: unknown): string {
  if (obj == null) return "";
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return String(obj);
  const r = obj as Record<string, unknown>;
  if (typeof r.message === "string" && r.message.trim()) return r.message.trim();
  if (typeof r.error === "string" && r.error.trim()) return r.error.trim();
  if (r.error && typeof r.error === "object") {
    const inner = extractNestedMessage(r.error);
    if (inner) return inner;
  }
  return "";
}

/**
 * レスポンス本文（JSON 文字列）からエラー内容を抽出して分類する。
 */
export function parseOpenAiCompatibleErrorBody(raw: string): ParsedAiApiError {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      kind: "unknown",
      message: "",
      codeHint: "",
    };
  }

  let root: unknown;
  try {
    root = JSON.parse(trimmed) as unknown;
  } catch {
    if (/1048576|1[,\s]?048[,\s]?576/.test(trimmed)) {
      return {
        kind: "context",
        message: trimmed.slice(0, 1200),
        codeHint: "",
      };
    }
    return {
      kind: "unknown",
      message: trimmed.slice(0, 1200),
      codeHint: "",
    };
  }

  let message = "";
  let codeHint = "";

  if (root && typeof root === "object") {
    const o = root as Record<string, unknown>;
    const err = o.error;
    if (typeof err === "string") {
      message = err;
    } else if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      message = extractNestedMessage(e);
      const code =
        (typeof e.code === "string" && e.code) ||
        (typeof e.type === "string" && e.type) ||
        "";
      codeHint = code;
    }
    if (!message && typeof o.message === "string") {
      message = o.message;
    }
  }

  if (!message) {
    message = extractNestedMessage(root);
  }

  const combined = `${codeHint} ${message}`.toLowerCase();
  const rawForLimit = `${codeHint} ${message}`;
  const mentions1048576 = /1048576|1[,\s]?048[,\s]?576/.test(rawForLimit);

  let kind: AiApiErrorKind = "unknown";
  if (
    mentions1048576 ||
    /context[_\s]?length|maximum\s+context|token\s+limit|too\s+many\s+tokens|max_tokens|入力が長すぎ|コンテキスト.*超/.test(
      combined
    )
  ) {
    kind = "context";
  } else if (
    /content[_\s]?policy|safety|blocked|filter|responsible\s+ai|harmful|有害|安全/.test(
      combined
    )
  ) {
    kind = "safety";
  } else if (/rate\s*limit|429|quota|resource_exhausted|レート|割り当て/.test(combined)) {
    kind = "rate";
  } else if (/invalid_request|invalid_argument|bad_request|malformed/.test(combined)) {
    kind = "invalid_request";
  }

  return {
    kind,
    message: message.slice(0, 2000),
    codeHint: codeHint.slice(0, 200),
  };
}

/**
 * ユーザー向けの 1 行説明（ログ・API 応答に載せる）
 */
export function formatOpenAiCompatibleErrorForHuman(raw: string): string {
  const { kind, message, codeHint } = parseOpenAiCompatibleErrorBody(raw);
  const detail = [codeHint, message].filter(Boolean).join(" — ").trim();
  const base = detail || raw.trim().slice(0, 800);

  switch (kind) {
    case "context":
      return `[コンテキスト超過の可能性] 入力トークンが約 ${HIKAMER_CONTEXT_TOKEN_SOFT_LIMIT.toLocaleString("en-US")}（1048576）を超えた、またはモデル上限に近い可能性があります。wikitext / ツイートを短くするか分割してください。 ${base}`;
    case "safety":
      return `[コンテンツフィルター・安全規制の可能性] モデルまたはゲートウェイが応答を拒否しました。 ${base}`;
    case "rate":
      return `[レート制限・クォータ] ${base}`;
    case "invalid_request":
      return `[リクエスト不正の可能性] ${base}`;
    default:
      return base;
  }
}
