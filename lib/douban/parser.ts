import * as cheerio from "cheerio";

import type {
  CandidateMovie,
  MovieRecord,
  MovieVersion,
  PlatformOffer,
} from "../../types/movie";

interface SuggestionItem {
  id: string;
  title?: string;
  sub_title?: string;
  year?: string;
  url?: string;
  type?: string;
  img?: string;
}

function parseDurationLabelToSeconds(label: string): number | null {
  const cleaned = label.trim();
  const hoursMatch = cleaned.match(/(\d+)\s*小时\s*(\d+)\s*分钟?/);
  if (hoursMatch) {
    return Number(hoursMatch[1]) * 3600 + Number(hoursMatch[2]) * 60;
  }

  const minuteMatch = cleaned.match(/(\d+)\s*分钟/);
  if (minuteMatch) {
    return Number(minuteMatch[1]) * 60;
  }

  return null;
}

function extractRuntimeParts(runtimeText: string): { runtimeLabel: string; note?: string } {
  const cleaned = runtimeText.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.*?分钟)(?:[（(]([^（）()]+)[)）])?$/);

  if (!match) {
    return { runtimeLabel: cleaned };
  }

  return {
    runtimeLabel: match[1].trim(),
    note: match[2]?.trim() || undefined,
  };
}

function parseRuntimeVariants(rawText: string, sourceIdPrefix: string): MovieVersion[] {
  const normalized = rawText.replace(/^片长:\s*/, "").trim();

  return normalized
    .split(/\s*\/\s*/)
    .map((segment, index) => {
      const { runtimeLabel, note } = extractRuntimeParts(segment);
      const seconds = parseDurationLabelToSeconds(runtimeLabel);

      if (!seconds) {
        return null;
      }

      return {
        id: `${sourceIdPrefix}-${index + 1}`,
        label: note ? `${runtimeLabel}(${note})` : runtimeLabel,
        durationSeconds: seconds,
        source: "豆瓣详情页",
        tag: mapVersionTag(note || runtimeLabel),
        notes: note || undefined,
      } satisfies MovieVersion;
    })
    .filter(Boolean) as MovieVersion[];
}

function mapVersionTag(label: string): MovieVersion["tag"] {
  if (label.includes("导演剪辑")) return "director-cut";
  if (label.includes("电影节") || label.includes("节展") || label.includes("威尼斯") || label.includes("柏林") || label.includes("戛纳")) return "festival";
  if (label.includes("中国大陆") || label.includes("内地")) return "mainland";
  if (label.includes("国际") || label.includes("美国") || label.includes("英国") || label.includes("香港") || label.includes("台湾")) return "international";
  if (label.includes("加长")) return "extended";
  if (label.includes("修复")) return "restored";
  return "unknown";
}

function normalizePlatformUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return "";

  if (rawUrl.startsWith("https://www.douban.com/link2/?url=")) {
    const parsed = new URL(rawUrl);
    return parsed.searchParams.get("url") ?? rawUrl;
  }

  return rawUrl;
}

function normalizeImageUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  if (rawUrl.startsWith("//")) {
    return `https:${rawUrl}`;
  }

  if (rawUrl.startsWith("http://")) {
    return rawUrl.replace("http://", "https://");
  }

  return rawUrl;
}

function textLinesFromInfo($: cheerio.CheerioAPI): string[] {
  return $("#info")
    .text()
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function parseSuggestionCandidates(rawJson: string): CandidateMovie[] {
  const items = JSON.parse(rawJson) as SuggestionItem[];

  return items
    .filter((item) => item.type === "movie" && item.id && item.title)
    .map((item) => ({
      id: `douban:${item.id}`,
      title: item.title ?? "未知电影",
      originalTitle: item.sub_title ?? "",
      year: Number(item.year ?? 0),
      director: "待从详情页获取",
      doubanUrl: item.url ?? `https://movie.douban.com/subject/${item.id}/`,
      posterUrl: normalizeImageUrl(item.img),
    }));
}

export function parseDoubanMovieRecord(subjectId: string, html: string): MovieRecord {
  const $ = cheerio.load(html);
  const infoLines = textLinesFromInfo($);
  const titleText = $("#content h1 span").first().text().trim();
  const yearText = $("#content h1 span.year").text().replace(/[()]/g, "").trim();
  const director = $("#info a[rel='v:directedBy']").first().text().trim();
  const ratingText = $("strong[property='v:average']").first().text().trim();
  const summary = $("span[property='v:summary']").text().replace(/\s+/g, " ").trim();
  const originalTitleLine = infoLines.find((line) => line.startsWith("原名:"));
  const posterUrl = normalizeImageUrl(
    $("#mainpic img").attr("src") ?? $("#mainpic img").attr("data-src"),
  );

  const runtimeNodes = $("#info span[property='v:runtime']");
  const versionsFromNodes = runtimeNodes
    .map((index, element) => {
      const rawRuntime = $(element).text().trim();
      const { runtimeLabel, note } = extractRuntimeParts(rawRuntime);
      const seconds = parseDurationLabelToSeconds(runtimeLabel);

      if (!seconds) {
        return null;
      }

      return {
        id: `runtime-${index + 1}`,
        label: note ? `${runtimeLabel}(${note})` : runtimeLabel,
        durationSeconds: seconds,
        source: "豆瓣详情页",
        tag: mapVersionTag(note || runtimeLabel),
        notes: note || undefined,
      } satisfies MovieVersion;
    })
    .get()
    .filter(Boolean) as MovieVersion[];

  const platforms = $("a.playBtn")
    .map((index, element) => {
      const platform = $(element).attr("data-cn")?.trim() || `播放源 ${index + 1}`;
      const url = normalizePlatformUrl($(element).attr("href"));

      return {
        id: `douban-platform-${index + 1}`,
        platform,
        available: true,
        url,
        notes: "已从豆瓣播放源区块识别，真实片长待下一步抓取。",
      } satisfies PlatformOffer;
    })
    .get();

  const fallbackRuntimeText = infoLines.find((line) => line.startsWith("片长:"));
  const versionsFromLine = fallbackRuntimeText
    ? parseRuntimeVariants(fallbackRuntimeText, "runtime-line")
    : [];
  const fallbackSeconds = fallbackRuntimeText
    ? parseDurationLabelToSeconds(fallbackRuntimeText)
    : null;

  const versions = [...versionsFromNodes, ...versionsFromLine].filter(
    (version, index, list) =>
      list.findIndex(
        (candidate) =>
          candidate.label === version.label &&
          candidate.durationSeconds === version.durationSeconds,
      ) === index,
  );

  const safeVersions: MovieVersion[] =
    versions.length > 0
      ? versions
      : [
          {
            id: "runtime-fallback",
            label: fallbackRuntimeText || "豆瓣主显示片长",
            durationSeconds: fallbackSeconds ?? 0,
            source: "豆瓣详情页",
            tag: "unknown",
          },
        ];

  return {
    id: `douban:${subjectId}`,
    inputHints: [titleText, yearText, subjectId].filter(Boolean),
    title: titleText,
    originalTitle: originalTitleLine?.replace(/^原名:\s*/, "") ?? "",
    year: Number(yearText || 0),
    director: director || "待确认",
    doubanRating: Number(ratingText || 0),
    doubanUrl: `https://movie.douban.com/subject/${subjectId}/`,
    posterUrl,
    summary: summary || "豆瓣简介暂未解析到。",
    versions: safeVersions,
    platforms,
  };
}
