import { createHash } from "node:crypto";

const browserHeaders = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};
const PASSED_COOKIE_TTL_MS = 10 * 60 * 1000;

let cachedPassedCookies: { value: string; expiresAt: number } | null = null;

function sha512(value: string): string {
  return createHash("sha512").update(value).digest("hex");
}

function solveChallenge(cha: string, difficulty = 4): number {
  const prefix = "0".repeat(difficulty);
  let nonce = 0;

  while (true) {
    nonce += 1;

    if (sha512(`${cha}${nonce}`).startsWith(prefix)) {
      return nonce;
    }
  }
}

async function requestPassedCookies(subjectId: string): Promise<string> {
  const subjectUrl = `https://movie.douban.com/subject/${subjectId}/`;
  const firstResponse = await fetch(subjectUrl, {
    headers: browserHeaders,
    redirect: "manual",
    cache: "no-store",
  });
  const bidCookie = firstResponse.headers.get("set-cookie")?.split(";")[0];
  const secUrl = firstResponse.headers.get("location");

  if (!secUrl || !bidCookie) {
    throw new Error("无法初始化豆瓣挑战页");
  }

  const challengeResponse = await fetch(secUrl, {
    headers: {
      ...browserHeaders,
      cookie: bidCookie,
    },
    cache: "no-store",
  });
  const challengeHtml = await challengeResponse.text();

  const tok = challengeHtml.match(/id="tok"[^>]*value="([^"]+)"/)?.[1];
  const cha = challengeHtml.match(/id="cha"[^>]*value="([^"]+)"/)?.[1];
  const red = challengeHtml.match(/id="red"[^>]*value="([^"]+)"/)?.[1];

  if (!tok || !cha || !red) {
    throw new Error("无法解析豆瓣挑战页字段");
  }

  const sol = solveChallenge(cha);
  const body = new URLSearchParams({
    tok,
    cha,
    sol: String(sol),
    red,
  });
  const submitResponse = await fetch("https://sec.douban.com/c", {
    method: "POST",
    headers: {
      ...browserHeaders,
      "content-type": "application/x-www-form-urlencoded",
      cookie: bidCookie,
      referer: secUrl,
    },
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const secCookies = (submitResponse.headers.get("set-cookie") ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part && part.includes("=")));

  return [bidCookie, ...secCookies].join("; ");
}

async function getPassedCookies(subjectId: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedPassedCookies && cachedPassedCookies.expiresAt > Date.now()) {
    return cachedPassedCookies.value;
  }

  const cookies = await requestPassedCookies(subjectId);
  cachedPassedCookies = {
    value: cookies,
    expiresAt: Date.now() + PASSED_COOKIE_TTL_MS,
  };

  return cookies;
}

function clearPassedCookies() {
  cachedPassedCookies = null;
}

function looksLikeDoubanSubjectHtml(html: string): boolean {
  return (
    html.includes('property="v:itemreviewed"') ||
    html.includes('id="content"') ||
    html.includes("片长:") ||
    html.includes("导演:")
  );
}

export async function searchDoubanSuggestions(query: string): Promise<string> {
  const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: browserHeaders,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`豆瓣搜索失败：${response.status}`);
  }

  return response.text();
}

async function fetchSubjectHtmlWithCookies(
  subjectId: string,
  cookies: string,
): Promise<{ response: Response; html: string }> {
  const subjectUrl = `https://movie.douban.com/subject/${subjectId}/`;
  const response = await fetch(subjectUrl, {
    headers: {
      ...browserHeaders,
      cookie: cookies,
    },
    cache: "no-store",
  });

  return {
    response,
    html: await response.text(),
  };
}

export async function fetchDoubanSubjectHtml(
  subjectId: string,
  options?: { forceCookieRefresh?: boolean },
): Promise<string> {
  const initialCookies = await getPassedCookies(subjectId, options?.forceCookieRefresh);
  let { response, html } = await fetchSubjectHtmlWithCookies(subjectId, initialCookies);

  if (!response.ok || !looksLikeDoubanSubjectHtml(html)) {
    clearPassedCookies();
    const refreshedCookies = await getPassedCookies(subjectId, true);
    const retried = await fetchSubjectHtmlWithCookies(subjectId, refreshedCookies);
    response = retried.response;
    html = retried.html;
  }

  if (!response.ok) {
    throw new Error(`豆瓣详情页请求失败：${response.status}`);
  }

  if (!looksLikeDoubanSubjectHtml(html)) {
    throw new Error("豆瓣详情页返回了不完整内容。");
  }

  return html;
}
