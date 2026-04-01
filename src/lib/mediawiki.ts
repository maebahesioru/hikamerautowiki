import { cookieHeader, mergeSetCookieHeaders } from "@/lib/cookies";
import {
  fetchWithRetry,
  humanizeHttpError,
  humanizeNetworkError,
} from "@/lib/httpRetry";

/** UI 検索の各 Wiki API 呼び出しを打ち切る（無応答でハングしないように） */
const WIKI_SEARCH_HTTP_TIMEOUT_MS = 28_000;

export type WikiRevision = {
  title: string;
  pageid: number;
  wikitext: string;
  missing?: boolean;
};

function joinApiUrl(apiUrl: string, query: Record<string, string>): string {
  const u = new URL(apiUrl);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

export type WikiSearchHit = {
  title: string;
  snippet?: string;
};

/** タイトル単位でマージ（先に入ったヒットを優先） */
export function mergeWikiSearchHitsByTitle(
  a: WikiSearchHit[],
  b: WikiSearchHit[]
): WikiSearchHit[] {
  const m = new Map<string, WikiSearchHit>();
  for (const h of a) {
    m.set(h.title, h);
  }
  for (const h of b) {
    if (!m.has(h.title)) m.set(h.title, h);
  }
  return [...m.values()];
}

/** ページ名の同一判定（アンダースコア・大文字小文字の差を吸収） */
export function wikiTitlesLooselyEqual(a: string, b: string): boolean {
  return wikiTitleLooseKey(a) === wikiTitleLooseKey(b);
}

function wikiTitleLooseKey(s: string): string {
  return s.replace(/_/g, " ").trim().toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 検索スニペット内の HTML 実体参照をデコード（表示用） */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16))
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, "\u00A0")
    .replace(/&amp;/g, "&");
}

/** 一覧用に [[リンク|表示]] / '''太字''' などを素のテキストに近づける */
function stripWikiMarkupForSnippet(s: string): string {
  let t = s.replace(/\{\{[\s\S]*?\}\}/g, "");
  for (let i = 0; i < 8; i++) {
    const next = t.replace(
      /\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g,
      (_, page: string, label: string | undefined) =>
        String(label ?? page).trim()
    );
    if (next === t) break;
    t = next;
  }
  t = t.replace(/'{2,}/g, "");
  return t.replace(/\s+/g, " ").trim();
}

function stripWikiSnippetHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  let t = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  t = decodeHtmlEntities(t);
  t = stripWikiMarkupForSnippet(t);
  return t || undefined;
}

type MwQueryInfoBatch = {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: Array<{
      title: string;
      missing?: boolean;
      redirect?: boolean;
    }>;
  };
};

/** `prop=info` の `redirect` は拡張・古い API で誤爆しやすいので、厳密に真のときだけリダイレクトとみなす */
function isMwRedirectFlag(redirect: unknown): boolean {
  return redirect === true;
}

/**
 * `list=search` の各ヒットを、転送先の実ページタイトルに寄せる（`redirects=1`）。
 * 検索上位に #REDIRECT だけが並び、本記事が別名のとき一覧から消えるのを防ぐ。
 * そのうえで、いまだリダイレクトページとして解決できないものだけ除外する。
 */
async function resolveSearchHitsAndFilterRedirects(
  apiUrl: string,
  hits: WikiSearchHit[]
): Promise<WikiSearchHit[]> {
  if (hits.length === 0) return [];
  const normMap = new Map<string, string>();
  const redirectFromTo = new Map<string, string>();
  const redirectTitles = new Set<string>();

  for (const batch of chunk(hits, 50)) {
    let r: Response;
    try {
      r = await fetchWithRetry(
        joinApiUrl(apiUrl, {
          action: "query",
          titles: batch.map((h) => h.title).join("|"),
          redirects: "1",
          prop: "info",
          format: "json",
          formatversion: "2",
        }),
        undefined,
        { timeoutMs: WIKI_SEARCH_HTTP_TIMEOUT_MS }
      );
    } catch {
      throw new Error(humanizeNetworkError("wiki"));
    }
    if (!r.ok) {
      const t = await r.text();
      throw new Error(humanizeHttpError("wiki", r.status, t));
    }
    const data = (await r.json()) as MwQueryInfoBatch;
    for (const n of data.query?.normalized ?? []) {
      normMap.set(n.from, n.to);
    }
    for (const rd of data.query?.redirects ?? []) {
      if (rd.from && rd.to) redirectFromTo.set(rd.from, rd.to);
    }
    for (const p of data.query?.pages ?? []) {
      if (p.missing) continue;
      if (isMwRedirectFlag(p.redirect)) redirectTitles.add(p.title);
    }
  }

  const normalizeOne = (t: string) => normMap.get(t) ?? t;

  function redirectTargetFor(t: string): string | undefined {
    const direct =
      redirectFromTo.get(t) ?? redirectFromTo.get(normalizeOne(t));
    if (direct) return direct;
    const lk = wikiTitleLooseKey(t);
    for (const [from, to] of redirectFromTo) {
      if (wikiTitleLooseKey(from) === lk) return to;
    }
    return undefined;
  }

  function isRedirectOnlyTitle(title: string): boolean {
    if (redirectTitles.has(title)) return true;
    const lk = wikiTitleLooseKey(title);
    for (const r of redirectTitles) {
      if (wikiTitleLooseKey(r) === lk) return true;
    }
    return false;
  }

  /** 正規化 → 転送チェーンを解決（`redirects` の from は正規化済みのことが多い） */
  function resolveFinalTitle(input: string): string {
    let t = normalizeOne(input.trim());
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      if (seen.has(t)) break;
      seen.add(t);
      const nextRaw = redirectTargetFor(t);
      if (!nextRaw) break;
      t = normalizeOne(nextRaw);
    }
    return t;
  }

  const byLoose = new Map<string, WikiSearchHit>();
  for (const h of hits) {
    const finalTitle = resolveFinalTitle(h.title);
    if (isRedirectOnlyTitle(finalTitle)) continue;
    const lk = wikiTitleLooseKey(finalTitle);
    if (!byLoose.has(lk)) {
      byLoose.set(lk, { title: finalTitle, snippet: h.snippet });
    }
  }

  return [...byLoose.values()];
}

/**
 * CirrusSearch: タイトル補助。フレーズだけだと日本語サブページ（例: ヒカマーwiki:チラシの裏/しがマニ）で外れることがあるため
 * フレーズ・語の両方を試す。
 */
function buildIntitleSrsearches(q: string): string[] {
  const t = q.trim();
  if (t.length < 2 || t.length > 120) return [];
  if (/[\n\r]/.test(t)) return [];
  const escaped = t.replace(/"/g, "").trim();
  if (!escaped) return [];
  return [`intitle:"${escaped}"`, `intitle:${escaped}`];
}

/**
 * UI の「しがマニ」だけの入力など、検索インデックスに乗らないときのフォールバック。
 * `page.tsx` の人物新規と同じプレフィックスでタイトルを組み立て、`query` で実在するかだけ見る。
 */
const CHIRASHI_SUBPAGE_PREFIX = "ヒカマーwiki:チラシの裏/";
const LEGACY_CHIRASHI_SUBPAGE_PREFIX = "チラシの裏/";

/** キーワードから「チラシの裏」系の候補タイトルを列挙（最大数件） */
function candidateChirashiTitlesForDirectLookup(q: string): string[] {
  const t = q.trim();
  if (t.length < 2) return [];
  const out: string[] = [];

  if (t.startsWith(CHIRASHI_SUBPAGE_PREFIX)) {
    out.push(t);
    return out;
  }
  if (t.startsWith(LEGACY_CHIRASHI_SUBPAGE_PREFIX) && !t.includes(":")) {
    out.push(`ヒカマーwiki:${t}`);
    out.push(t);
    return out;
  }
  if (!t.includes("/") && !t.includes(":")) {
    out.push(`${CHIRASHI_SUBPAGE_PREFIX}${t}`);
    out.push(`${LEGACY_CHIRASHI_SUBPAGE_PREFIX}${t}`);
    return out;
  }
  if (t.includes("/") && !t.includes(":")) {
    out.push(`ヒカマーwiki:${t}`);
    return out;
  }
  return [];
}

type MwQueryTitlesInfo = {
  query?: {
    pages?: Array<{ title: string; missing?: boolean }>;
  };
};

/** `list=search` を経由せず、実在ページ名だけ返す（検索が空でもヒットさせる） */
async function fetchExistingTitlesHits(
  apiUrl: string,
  titles: string[]
): Promise<WikiSearchHit[]> {
  if (titles.length === 0) return [];
  const uniq = [...new Set(titles)];
  const batch = uniq.slice(0, 40);
  try {
    const r = await fetchWithRetry(
      joinApiUrl(apiUrl, {
        action: "query",
        titles: batch.join("|"),
        prop: "info",
        format: "json",
        formatversion: "2",
      }),
      undefined,
      { timeoutMs: WIKI_SEARCH_HTTP_TIMEOUT_MS }
    );
    if (!r.ok) return [];
    const data = (await r.json()) as MwQueryTitlesInfo;
    const hits: WikiSearchHit[] = [];
    for (const p of data.query?.pages ?? []) {
      if (p.missing) continue;
      hits.push({
        title: p.title,
        snippet: "（タイトル直接照会）",
      });
    }
    return hits;
  } catch {
    return [];
  }
}

async function fetchChirashiDirectTitleHits(
  apiUrl: string,
  q: string
): Promise<WikiSearchHit[]> {
  const candidates = candidateChirashiTitlesForDirectLookup(q);
  return fetchExistingTitlesHits(apiUrl, candidates);
}

/** `foo/bar` のとき `bar` でもタイトル検索（サブページ末尾だけ入力されがち） */
function buildSubpageTailIntitle(q: string): string | null {
  const t = q.trim();
  if (!t.includes("/")) return null;
  const tail = t.split("/").pop()?.trim() ?? "";
  if (tail.length < 2 || tail === t) return null;
  return `intitle:${tail.replace(/"/g, "")}`;
}

function parseOpenSearchTitles(data: unknown): string[] {
  if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) {
    return data[1].filter((x): x is string => typeof x === "string");
  }
  return [];
}

async function fetchOpenSearchHits(
  apiUrl: string,
  q: string,
  limit: number
): Promise<WikiSearchHit[]> {
  try {
    const r = await fetchWithRetry(
      joinApiUrl(apiUrl, {
        action: "opensearch",
        search: q,
        limit: String(Math.min(Math.max(limit, 1), 50)),
        format: "json",
      }),
      undefined,
      { timeoutMs: WIKI_SEARCH_HTTP_TIMEOUT_MS }
    );
    if (!r.ok) return [];
    const data: unknown = await r.json();
    return parseOpenSearchTitles(data).map((title) => ({
      title,
      snippet: undefined,
    }));
  } catch {
    return [];
  }
}

type ListSearchOpts = {
  /** 既定は全文。タイトルに語が含まれるページを拾う（サブページ名の部分一致に効くことが多い） */
  srwhat?: "text" | "title" | "neartitle";
};

async function fetchListSearchHits(
  apiUrl: string,
  srsearch: string,
  srlimit: number,
  opts?: ListSearchOpts
): Promise<WikiSearchHit[]> {
  const params: Record<string, string> = {
    action: "query",
    list: "search",
    srsearch,
    srlimit: String(srlimit),
    format: "json",
    formatversion: "2",
  };
  if (opts?.srwhat) params.srwhat = opts.srwhat;
  const r = await fetchWithRetry(joinApiUrl(apiUrl, params), undefined, {
    timeoutMs: WIKI_SEARCH_HTTP_TIMEOUT_MS,
  });
  const rawText = await r.text();
  if (!r.ok) {
    throw new Error(
      humanizeHttpError("wiki", r.status, rawText.slice(0, 400))
    );
  }
  let data: {
    error?: { code?: string; info?: string };
    query?: { search?: Array<{ title: string; snippet?: string }> };
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    throw new Error("Wiki 検索: JSON を解釈できませんでした");
  }
  if (data.error) {
    const info = data.error.info ?? data.error.code ?? "unknown";
    throw new Error(`Wiki 検索: ${info}`);
  }
  const rows = data.query?.search ?? [];
  return rows.map((x) => ({
    title: x.title,
    snippet: stripWikiSnippetHtml(x.snippet),
  }));
}

/** 補助検索用（intitle 未対応・一時エラーでも全体を落とさない） */
async function fetchListSearchHitsSafe(
  apiUrl: string,
  srsearch: string,
  srlimit: number,
  opts?: ListSearchOpts
): Promise<WikiSearchHit[]> {
  try {
    return await fetchListSearchHits(apiUrl, srsearch, srlimit, opts);
  } catch {
    return [];
  }
}

/**
 * ログイン不要。`list=search` + `opensearch` +（可能なら）`intitle:` 補助をマージ。
 * `srnamespace` は送らない（ウィキ既定の検索対象）。`*` を付けると一部環境で Search バックエンドが 500 になる。
 */
export async function searchWikiPages(
  apiUrl: string,
  searchQuery: string,
  limit = 15
): Promise<WikiSearchHit[]> {
  const q = searchQuery.trim();
  if (!q) return [];
  const n = Math.min(Math.max(limit, 1), 50);
  /** リダイレクト解決・除外後も件数を確保しやすいよう多めに取る */
  const fetchLimit = Math.min(50, Math.max(n + 35, 30));
  const intitleQueries = buildIntitleSrsearches(q);
  const tailIntitle = buildSubpageTailIntitle(q);

  const intitleFetches = intitleQueries.map((iq) =>
    fetchListSearchHitsSafe(apiUrl, iq, fetchLimit)
  );
  const [directHits, openHits, mainMapped, titleMapped, ...intitleParts] =
    await Promise.all([
      fetchChirashiDirectTitleHits(apiUrl, q),
      fetchOpenSearchHits(apiUrl, q, Math.max(n, 30)),
      fetchListSearchHits(apiUrl, q, fetchLimit),
      fetchListSearchHitsSafe(apiUrl, q, fetchLimit, { srwhat: "title" }),
      ...intitleFetches,
      tailIntitle
        ? fetchListSearchHitsSafe(apiUrl, tailIntitle, fetchLimit)
        : Promise.resolve([] as WikiSearchHit[]),
    ]);

  /** チラシの裏の実在タイトル → opensearch → 全文 → タイトル専用 → intitle 各種 */
  let merged = mergeWikiSearchHitsByTitle(directHits, openHits);
  merged = mergeWikiSearchHitsByTitle(merged, titleMapped);
  for (const part of intitleParts) {
    merged = mergeWikiSearchHitsByTitle(merged, part);
  }
  /** 解決 API の負荷とノイズ抑制（重複は merge で既に除去） */
  merged = merged.slice(0, 96);

  const resolved = await resolveSearchHitsAndFilterRedirects(apiUrl, merged);
  const usable = resolved.length > 0 ? resolved : merged;
  return usable.slice(0, n);
}

async function postForm(
  apiUrl: string,
  jar: Map<string, string>,
  body: URLSearchParams
): Promise<Response> {
  try {
    return await fetchWithRetry(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...cookieHeader(jar),
      },
      body,
    });
  } catch {
    throw new Error(humanizeNetworkError("wiki"));
  }
}

export async function mediaWikiLogin(
  apiUrl: string,
  username: string,
  password: string
): Promise<{ jar: Map<string, string>; csrfToken: string }> {
  const jar = new Map<string, string>();

  let r: Response;
  try {
    r = await fetchWithRetry(
      joinApiUrl(apiUrl, {
        action: "query",
        meta: "tokens",
        type: "login",
        format: "json",
      }),
      { headers: cookieHeader(jar) }
    );
  } catch {
    throw new Error(humanizeNetworkError("wiki"));
  }
  mergeSetCookieHeaders(jar, r);
  const loginTokenJson = (await r.json()) as {
    query?: { tokens?: { logintoken?: string } };
  };
  const loginToken = loginTokenJson.query?.tokens?.logintoken;
  if (!loginToken) throw new Error("MediaWiki: login token を取得できませんでした");

  const loginBody = new URLSearchParams({
    action: "login",
    lgname: username,
    lgpassword: password,
    lgtoken: loginToken,
    format: "json",
  });
  r = await postForm(apiUrl, jar, loginBody);
  mergeSetCookieHeaders(jar, r);
  const loginResult = (await r.json()) as {
    login?: { result?: string; reason?: string };
  };
  if (loginResult.login?.result !== "Success") {
    const reason = loginResult.login?.reason ?? "unknown";
    // サーバー側ログ（ターミナル）で result / 追加フィールドを確認できる
    console.error("[mediaWikiLogin] failed:", JSON.stringify(loginResult));
    throw new Error(`MediaWiki ログイン失敗: ${reason}`);
  }

  try {
    r = await fetchWithRetry(
      joinApiUrl(apiUrl, {
        action: "query",
        meta: "tokens",
        type: "csrf",
        format: "json",
      }),
      { headers: cookieHeader(jar) }
    );
  } catch {
    throw new Error(humanizeNetworkError("wiki"));
  }
  mergeSetCookieHeaders(jar, r);
  const csrfJson = (await r.json()) as {
    query?: { tokens?: { csrftoken?: string } };
  };
  const csrfToken = csrfJson.query?.tokens?.csrftoken;
  if (!csrfToken || csrfToken === "+\\") {
    throw new Error("MediaWiki: CSRF token を取得できませんでした");
  }

  return { jar, csrfToken };
}

/** ログインなし（閲覧可能な記事のみ） */
export async function fetchWikiWikitextPublic(
  apiUrl: string,
  title: string
): Promise<WikiRevision> {
  let r: Response;
  try {
    r = await fetchWithRetry(
      joinApiUrl(apiUrl, {
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: title,
        format: "json",
        formatversion: "2",
      })
    );
  } catch {
    throw new Error(humanizeNetworkError("wiki"));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(humanizeHttpError("wiki", r.status, t));
  }
  const data = (await r.json()) as {
    query?: {
      pages?: Array<{
        title: string;
        pageid: number;
        missing?: boolean;
        revisions?: Array<{ slots?: { main?: { content?: string } } }>;
      }>;
    };
  };
  const page = data.query?.pages?.[0];
  if (!page) {
    return { title, pageid: 0, wikitext: "", missing: true };
  }
  if (page.missing) {
    return { title: page.title, pageid: page.pageid, wikitext: "", missing: true };
  }
  const wikitext =
    page.revisions?.[0]?.slots?.main?.content ?? "";
  return {
    title: page.title,
    pageid: page.pageid,
    wikitext,
    missing: false,
  };
}

export async function fetchWikiWikitext(
  apiUrl: string,
  jar: Map<string, string>,
  title: string
): Promise<WikiRevision> {
  let r: Response;
  try {
    r = await fetchWithRetry(
      joinApiUrl(apiUrl, {
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: title,
        format: "json",
        formatversion: "2",
      }),
      { headers: cookieHeader(jar) }
    );
  } catch {
    throw new Error(humanizeNetworkError("wiki"));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(humanizeHttpError("wiki", r.status, t));
  }
  const data = (await r.json()) as {
    query?: {
      pages?: Array<{
        title: string;
        pageid: number;
        missing?: boolean;
        revisions?: Array<{ slots?: { main?: { content?: string } } }>;
      }>;
    };
  };
  const page = data.query?.pages?.[0];
  if (!page) {
    return { title, pageid: 0, wikitext: "", missing: true };
  }
  if (page.missing) {
    return { title: page.title, pageid: page.pageid, wikitext: "", missing: true };
  }
  const wikitext =
    page.revisions?.[0]?.slots?.main?.content ?? "";
  return {
    title: page.title,
    pageid: page.pageid,
    wikitext,
    missing: false,
  };
}

export async function editWikiPage(
  apiUrl: string,
  jar: Map<string, string>,
  csrfToken: string,
  title: string,
  text: string,
  summary: string
): Promise<{ revid?: number; newrevid?: number }> {
  const body = new URLSearchParams({
    action: "edit",
    title,
    text,
    summary,
    token: csrfToken,
    format: "json",
  });
  const r = await postForm(apiUrl, jar, body);
  mergeSetCookieHeaders(jar, r);
  const result = (await r.json()) as {
    edit?: { result?: string; revid?: number; newrevid?: number };
    error?: { code?: string; info?: string };
  };
  if (result.error) {
    throw new Error(
      `MediaWiki 編集エラー: ${result.error.code ?? ""} ${result.error.info ?? ""}`
    );
  }
  if (result.edit?.result !== "Success") {
    throw new Error("MediaWiki: 編集が Success ではありませんでした");
  }
  return {
    revid: result.edit?.revid,
    newrevid: result.edit?.newrevid,
  };
}

export type UploadFileToMediaWikiResult = {
  /** アップロード後のファイル名（名前空間なし、例: Hikamer_xxx_foo.jpg） */
  filename: string;
};

/**
 * バイナリを MediaWiki にアップロード（action=upload）。
 * ボットに upload 権限が必要。
 */
export async function uploadFileToMediaWiki(
  apiUrl: string,
  jar: Map<string, string>,
  csrfToken: string,
  options: {
    filename: string;
    data: Uint8Array;
    contentType?: string;
    comment?: string;
  }
): Promise<UploadFileToMediaWikiResult> {
  const comment =
    options.comment ??
    "Hikamer autowiki: X（Twitter）メディアの参照用アップロード";

  const form = new FormData();
  form.append("action", "upload");
  form.append("format", "json");
  form.append("token", csrfToken);
  form.append("filename", options.filename);
  form.append("ignorewarnings", "true");
  form.append("comment", comment);
  const blob = new Blob([Buffer.from(options.data)], {
    type: options.contentType ?? "application/octet-stream",
  });
  form.append("file", blob, options.filename);

  let r: Response;
  try {
    r = await fetch(apiUrl, {
      method: "POST",
      body: form,
      headers: cookieHeader(jar),
    });
  } catch {
    throw new Error(humanizeNetworkError("wiki"));
  }
  mergeSetCookieHeaders(jar, r);

  const raw = (await r.json()) as {
    upload?: {
      result?: string;
      filename?: string;
      warnings?: unknown;
    };
    error?: { code?: string; info?: string };
  };

  if (raw.error) {
    throw new Error(
      `MediaWiki アップロード: ${raw.error.code ?? ""} ${raw.error.info ?? ""}`.trim()
    );
  }
  if (raw.upload?.result !== "Success") {
    throw new Error(
      `MediaWiki アップロード: 失敗（result=${String(raw.upload?.result)}）`
    );
  }
  const fn = raw.upload?.filename?.trim();
  if (!fn) {
    throw new Error("MediaWiki アップロード: 応答に filename がありません");
  }
  return { filename: fn };
}
