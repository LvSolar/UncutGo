import * as cheerio from "cheerio";

import type { MovieRecord, PlatformOffer } from "../../types/movie";
import { fetchLibvioDurationViaBrowser } from "./libvio-browser";
import { normalizeForMatch, parseDurationLabelToSeconds } from "./shared";

const LIBVIO_PUBLISH_URL = "https://www.libvio.app/";
const LIBVIO_FALLBACK_BASE_URLS = [
  "https://libvio.run",
  "https://www.libvio.in",
  "https://libvio.mov",
  "https://libvio.la",
  "https://www.libvio.life",
];
const minimumFeatureSeconds = 20 * 60;
const maximumFeatureSeconds = 6 * 60 * 60;
const libvioUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

let cachedBaseUrl: { value: string; expiresAt: number } | null = null;

interface SearchCandidate {
  title: string;
  detailUrl: string;
}

function extractDoubanSubjectId(url: string): string | null {
  return url.match(/subject\/(\d+)/)?.[1] ?? null;
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

function buildCookieHeader(headers: Headers): string {
  const raw = headers.get("set-cookie");

  if (!raw) {
    return "";
  }

  return raw
    .split(/,(?=[^;]+?=)/)
    .map((item) => item.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();

  return values.filter((value) => {
    const trimmed = value.trim();

    if (!trimmed) {
      return false;
    }

    const key = trimmed.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function extractChinesePhrases(value: string): string[] {
  return value.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
}

function extractEnglishPhrases(value: string): string[] {
  return value
    .split(/[\/|｜:,：()（）\-]/)
    .map((part) => part.trim())
    .filter((part) => /[a-zA-Z]/.test(part) && !/[\u4e00-\u9fff]/.test(part));
}

function buildSearchQueries(movie: MovieRecord): string[] {
  const baseValues = [movie.title, movie.originalTitle, ...movie.inputHints].filter(Boolean);
  const queries: string[] = [];

  for (const value of baseValues) {
    queries.push(value);
    queries.push(...extractChinesePhrases(value));
    queries.push(...extractEnglishPhrases(value));

    const splitVariants = value
      .split(/\s{2,}|\s+-\s+|\s+\|\s+|\s+\/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    queries.push(...splitVariants);
  }

  return uniqueNonEmpty(queries).sort((left, right) => {
    const leftHasChinese = /[\u4e00-\u9fff]/.test(left);
    const rightHasChinese = /[\u4e00-\u9fff]/.test(right);

    if (leftHasChinese !== rightHasChinese) {
      return leftHasChinese ? -1 : 1;
    }

    return left.length - right.length;
  });
}

async function fetchText(url: string, headers?: Record<string, string>) {
  const response = await fetch(url, {
    headers: {
      "user-agent": libvioUserAgent,
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...headers,
    },
    cache: "no-store",
  });

  return {
    response,
    html: await response.text(),
  };
}

async function resolveLibvioBaseUrl(): Promise<string> {
  if (cachedBaseUrl && cachedBaseUrl.expiresAt > Date.now()) {
    return cachedBaseUrl.value;
  }

  const candidates = new Set<string>(LIBVIO_FALLBACK_BASE_URLS);

  try {
    const { response, html } = await fetchText(LIBVIO_PUBLISH_URL, {
      referer: "https://movie.douban.com/",
    });

    if (response.ok) {
      const $ = cheerio.load(html);
      $("a[href]").each((_, element) => {
        const href = $(element).attr("href")?.trim();
        const text = $(element).text().trim();

        if (!href) {
          return;
        }

        if (text.includes("备用线路") || href.includes("libvio")) {
          candidates.add(href.replace(/\/+$/, ""));
        }
      });
    }
  } catch {
    // Fall back to known domains below.
  }

  for (const candidate of candidates) {
    try {
      const { response, html } = await fetchText(candidate, {
        referer: LIBVIO_PUBLISH_URL,
      });

      if (response.ok && html.includes('action="/search/-------------.html"')) {
        cachedBaseUrl = {
          value: candidate.replace(/\/+$/, ""),
          expiresAt: Date.now() + 30 * 60 * 1000,
        };
        return cachedBaseUrl.value;
      }
    } catch {
      // Try the next domain.
    }
  }

  return LIBVIO_FALLBACK_BASE_URLS[0];
}

function parseSearchCandidates(baseUrl: string, html: string): SearchCandidate[] {
  const $ = cheerio.load(html);

  return $(".stui-vodlist__box")
    .map((_, element) => {
      const thumbAnchor = $(element).find("a.stui-vodlist__thumb[href*='/detail/']").first();
      const titleAnchor = $(element).find("h4 a[href*='/detail/']").first();
      const anchor = thumbAnchor.attr("href") ? thumbAnchor : titleAnchor;
      const href = anchor.attr("href")?.trim();
      const title = anchor.attr("title")?.trim() || anchor.text().trim();

      if (!href || !title) {
        return null;
      }

      return {
        title,
        detailUrl: absoluteUrl(baseUrl, href),
      } satisfies SearchCandidate;
    })
    .get()
    .filter(Boolean) as SearchCandidate[];
}

function scoreCandidateTitle(movie: MovieRecord, candidateTitle: string): number {
  const normalizedCandidate = normalizeForMatch(candidateTitle);
  const hints = [movie.title, movie.originalTitle, ...movie.inputHints]
    .filter(Boolean)
    .flatMap((value) => [value, ...extractChinesePhrases(value), ...extractEnglishPhrases(value)])
    .map((value) => normalizeForMatch(value));

  let score = 0;

  for (const hint of hints) {
    if (!hint) {
      continue;
    }

    if (normalizedCandidate === hint) {
      score = Math.max(score, 100);
    } else if (normalizedCandidate.includes(hint) || hint.includes(normalizedCandidate)) {
      score = Math.max(score, 60);
    }
  }

  return score;
}

async function pickBestDetailPage(
  baseUrl: string,
  movie: MovieRecord,
): Promise<{
  detailUrl: string;
  playUrl?: string;
  notes?: string;
} | null> {
  const queries = buildSearchQueries(movie);
  const targetDoubanId = extractDoubanSubjectId(movie.doubanUrl);
  let fallbackMatch:
    | {
        detailUrl: string;
        playUrl?: string;
        score: number;
      }
    | null = null;

  for (const query of queries) {
    const { response, html } = await fetchText(
      `${baseUrl}/search/-------------.html?wd=${encodeURIComponent(query)}`,
      { referer: `${baseUrl}/` },
    );

    if (!response.ok) {
      continue;
    }

    const candidates = parseSearchCandidates(baseUrl, html).slice(0, 8);

    for (const candidate of candidates) {
      const detailResponse = await fetchText(candidate.detailUrl, {
        referer: `${baseUrl}/search/-------------.html?wd=${encodeURIComponent(query)}`,
      });

      if (!detailResponse.response.ok) {
        continue;
      }

      const $ = cheerio.load(detailResponse.html);
      const detailTitle = $("h1.title").first().text().trim() || candidate.title;
      const doubanHref = $("a[href*='movie.douban.com/subject/']").first().attr("href")?.trim();
      const detailDoubanId = doubanHref ? extractDoubanSubjectId(doubanHref) : null;
      const playUrl =
        $("div.play-btn a[href*='/play/']").first().attr("href")?.trim() ||
        $(".playlist-panel a[href*='/play/']").first().attr("href")?.trim();

      if (targetDoubanId && detailDoubanId && targetDoubanId === detailDoubanId) {
        return {
          detailUrl: candidate.detailUrl,
          playUrl: playUrl ? absoluteUrl(baseUrl, playUrl) : undefined,
          notes: `已在 Libvio 搜索中通过关键词“${query}”匹配到同一豆瓣条目。`,
        };
      }

      const score = scoreCandidateTitle(movie, detailTitle);

      if (score > 0 && (!fallbackMatch || score > fallbackMatch.score)) {
        fallbackMatch = {
          detailUrl: candidate.detailUrl,
          playUrl: playUrl ? absoluteUrl(baseUrl, playUrl) : undefined,
          score,
        };
      }
    }
  }

  if (!fallbackMatch) {
    return null;
  }

  return {
    detailUrl: fallbackMatch.detailUrl,
    playUrl: fallbackMatch.playUrl,
    notes: "已在 Libvio 搜索中匹配到标题最接近的结果。",
  };
}

async function resolveEmbeddedPlayerUrl(playUrl: string): Promise<{
  embeddedUrl?: string;
  parseJsonUrl?: string;
  cookieHeader?: string;
}> {
  const playPage = await fetchText(playUrl, { referer: playUrl });

  if (!playPage.response.ok) {
    return {};
  }

  const playerMatch = playPage.html.match(/var player_aaaa=(\{.*?\})<\/script>/);

  if (!playerMatch) {
    return {};
  }

  const playerData = JSON.parse(playerMatch[1]) as {
    from?: string;
    url?: string;
    id?: string;
    nid?: number;
    link_next?: string;
  };

  if (!playerData.from || !playerData.url || !playerData.id || !playerData.nid) {
    return {};
  }

  const origin = new URL(playUrl).origin;
  const adapterUrl = `${origin}/static/player/${playerData.from}.js?v=3.9`;
  const adapterPage = await fetchText(adapterUrl, { referer: playUrl });

  if (!adapterPage.response.ok) {
    return {};
  }

  const phpMatch = adapterPage.html.match(/\/vid\/([a-z0-9_]+\.php)\?url=/i);

  if (!phpMatch) {
    return {};
  }

  const embeddedUrl = new URL(`/vid/${phpMatch[1]}`, origin);
  embeddedUrl.searchParams.set("url", playerData.url);
  embeddedUrl.searchParams.set("next", playerData.link_next ?? "");
  embeddedUrl.searchParams.set("id", playerData.id);
  embeddedUrl.searchParams.set("nid", String(playerData.nid));

  const embeddedPage = await fetchText(embeddedUrl.toString(), {
    referer: playUrl,
  });

  if (!embeddedPage.response.ok) {
    return {
      embeddedUrl: embeddedUrl.toString(),
    };
  }

  const parsePathMatch = embeddedPage.html.match(/fetch\('([^']*\/vid\/parse\.php\?[^']+)'/);
  const cookieHeader = buildCookieHeader(embeddedPage.response.headers);

  return {
    embeddedUrl: embeddedUrl.toString(),
    parseJsonUrl: parsePathMatch ? absoluteUrl(origin, parsePathMatch[1]) : undefined,
    cookieHeader,
  };
}

async function resolveMediaUrl(playUrl: string): Promise<string | null> {
  const playerUrls = await resolveEmbeddedPlayerUrl(playUrl);

  if (!playerUrls.parseJsonUrl || !playerUrls.embeddedUrl) {
    return null;
  }

  const response = await fetch(playerUrls.parseJsonUrl, {
    headers: {
      "user-agent": libvioUserAgent,
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: playerUrls.embeddedUrl,
      ...(playerUrls.cookieHeader ? { cookie: playerUrls.cookieHeader } : {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    url?: string;
  };

  return payload.url?.trim() || null;
}

async function sumM3u8Duration(manifestUrl: string, depth = 0): Promise<number | null> {
  if (depth > 2) {
    return null;
  }

  const response = await fetch(manifestUrl, {
    headers: {
      "user-agent": libvioUserAgent,
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: manifestUrl,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const text = await response.text();
  const extinfMatches = [...text.matchAll(/#EXTINF:([\d.]+)/g)];

  if (extinfMatches.length > 0) {
    const totalSeconds = Math.round(
      extinfMatches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0),
    );

    return totalSeconds >= minimumFeatureSeconds && totalSeconds <= maximumFeatureSeconds
      ? totalSeconds
      : null;
  }

  const variantLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = 0; index < variantLines.length; index += 1) {
    if (!variantLines[index].startsWith("#EXT-X-STREAM-INF")) {
      continue;
    }

    const nextLine = variantLines[index + 1];

    if (!nextLine || nextLine.startsWith("#")) {
      continue;
    }

    const nestedUrl = new URL(nextLine, manifestUrl).toString();
    const nestedDuration = await sumM3u8Duration(nestedUrl, depth + 1);

    if (nestedDuration) {
      return nestedDuration;
    }
  }

  return null;
}

async function readDurationFromPlayPage(playUrl: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
}> {
  const playPage = await fetchText(playUrl, {
    referer: playUrl,
  });

  if (!playPage.response.ok) {
    return {};
  }

  const $ = cheerio.load(playPage.html);
  const directLabel = $(".time-duration").first().text().trim();
  const regexLabel =
    playPage.html.match(/<span[^>]*class=["'][^"']*time-duration[^"']*["'][^>]*>([^<]+)</i)?.[1]?.trim() ??
    playPage.html.match(/time-duration[^>]*>\s*(\d{2}:\d{2}:\d{2})\s*</i)?.[1]?.trim() ??
    "";
  const durationLabel = directLabel || regexLabel;
  const durationSeconds = durationLabel ? parseDurationLabelToSeconds(durationLabel) : null;

  if (!durationSeconds) {
    return {};
  }

  if (durationSeconds < minimumFeatureSeconds || durationSeconds > maximumFeatureSeconds) {
    return {};
  }

  return {
    durationSeconds,
    durationLabel,
  };
}

async function fetchLibvioDuration(playUrl: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const playPageDuration = await readDurationFromPlayPage(playUrl);

  if (playPageDuration.durationSeconds && playPageDuration.durationLabel) {
    return {
      ...playPageDuration,
      notes: "已从 Libvio 播放页显示的时长元素中提取时长。",
    };
  }

  const mediaUrl = await resolveMediaUrl(playUrl);

  if (mediaUrl?.includes(".m3u8")) {
    const durationSeconds = await sumM3u8Duration(mediaUrl);

    if (durationSeconds) {
      const hours = String(Math.floor(durationSeconds / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((durationSeconds % 3600) / 60)).padStart(2, "0");
      const seconds = String(durationSeconds % 60).padStart(2, "0");

      return {
        durationSeconds,
        durationLabel: `${hours}:${minutes}:${seconds}`,
        notes: "已从 Libvio 播放页解析真实媒体地址，并通过 m3u8 清单计算时长。",
      };
    }
  }

  const browserDuration = await fetchLibvioDurationViaBrowser(playUrl);

  if (browserDuration.durationSeconds && browserDuration.durationLabel) {
    return browserDuration;
  }

  const notes = [
    mediaUrl
      ? "Libvio 已拿到真实媒体地址，但当前格式暂未通过直连方式算出可信时长。"
      : "Libvio 已定位到播放页，但暂时没有拿到可解析的真实媒体地址。",
    browserDuration.notes,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    notes: notes || "Libvio 当前仍未解析出可信时长。",
  };
}

export async function fetchLibvioOffer(movie: MovieRecord): Promise<PlatformOffer> {
  const baseUrl = await resolveLibvioBaseUrl();
  const fallbackSearchUrl = `${baseUrl}/search/-------------.html?wd=${encodeURIComponent(buildSearchQueries(movie)[0] ?? movie.title)}`;

  try {
    const detailMatch = await pickBestDetailPage(baseUrl, movie);

    if (!detailMatch) {
      return {
        id: "libvio-search",
        platform: "Libvio",
        available: false,
        url: fallbackSearchUrl,
        notes: "Libvio 站内搜索暂未找到匹配电影。",
      };
    }

    if (!detailMatch.playUrl) {
      return {
        id: "libvio-search",
        platform: "Libvio",
        available: true,
        url: detailMatch.detailUrl,
        notes: `${detailMatch.notes ?? "Libvio 已搜索到匹配电影。"} 但详情页暂未识别到可播放入口。`,
      };
    }

    const duration = await fetchLibvioDuration(detailMatch.playUrl);

    return {
      id: "libvio-search",
      platform: "Libvio",
      available: true,
      url: detailMatch.playUrl,
      notes: [detailMatch.notes, duration.notes].filter(Boolean).join(" "),
      durationSeconds: duration.durationSeconds,
      durationLabel: duration.durationLabel,
    };
  } catch (error) {
    return {
      id: "libvio-search",
      platform: "Libvio",
      available: false,
      url: fallbackSearchUrl,
      notes:
        error instanceof Error
          ? `Libvio 抓取失败：${error.message}`
          : "Libvio 抓取失败。",
    };
  }
}
