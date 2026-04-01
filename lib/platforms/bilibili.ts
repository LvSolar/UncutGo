import { durationFromValue, findBestDurationInText } from "./shared";

const minimumEpisodeSeconds = 30;
const maximumEpisodeSeconds = 8 * 60 * 60;

interface BilibiliEpisodeLike {
  aid?: number;
  cid?: number;
  duration?: number | string;
  ep_id?: number;
  id?: number;
  long_title?: string;
  share_copy?: string;
  share_url?: string;
  show_title?: string;
  subtitle?: string;
  title?: string;
  toast_title?: string;
}

interface BilibiliSeasonResult {
  episodes?: BilibiliEpisodeLike[];
  main_section?: {
    episodes?: BilibiliEpisodeLike[];
  };
  media?: {
    season_id?: number;
  };
}

interface BilibiliApiResponse {
  code?: number;
  message?: string;
  result?: BilibiliSeasonResult;
}

interface EpisodeDurationSummary {
  durationSeconds: number;
  durationLabel: string;
  notes: string;
  episodeCount: number;
  resolvedCount: number;
}

function parseClockToSeconds(label: string): number | null {
  const match = label.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  if (typeof match[3] === "string") {
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function formatClockDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildRequestHeaders(referer: string): HeadersInit {
  return {
    "user-agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    referer,
  };
}

function extractBangumiIds(url: string): {
  epId?: string;
  mediaId?: string;
  seasonId?: string;
} {
  const seasonId = url.match(/(?:[?&]season_id=|\/ss)(\d+)/i)?.[1];
  const epId = url.match(/(?:[?&]ep_id=|\/ep)(\d+)/i)?.[1];
  const mediaId = url.match(/(?:[?&]media_id=|\/md)(\d+)/i)?.[1];

  return {
    epId,
    mediaId,
    seasonId,
  };
}

function getEpisodeKey(episode: BilibiliEpisodeLike, index: number): string {
  const value = episode.ep_id ?? episode.cid ?? episode.aid ?? episode.id;

  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }

  return `index:${index}`;
}

function collectEpisodeDuration(episode: BilibiliEpisodeLike): number | null {
  const directDuration = durationFromValue(episode.duration);
  if (directDuration && directDuration > 0) {
    return directDuration;
  }

  const text = [
    episode.long_title,
    episode.show_title,
    episode.subtitle,
    episode.title,
    episode.toast_title,
    episode.share_copy,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join("\n");

  if (!text) {
    return null;
  }

  return findBestDurationInText(text, minimumEpisodeSeconds, maximumEpisodeSeconds)?.durationSeconds ?? null;
}

function summarizeEpisodeDurations(
  episodes: BilibiliEpisodeLike[],
  fallbackEpisodes: BilibiliEpisodeLike[] = [],
): EpisodeDurationSummary | null {
  const primaryDurationMap = new Map<string, number>();
  const fallbackDurationMap = new Map<string, number>();

  episodes.forEach((episode, index) => {
    const durationSeconds = collectEpisodeDuration(episode);

    if (durationSeconds && durationSeconds > 0) {
      primaryDurationMap.set(getEpisodeKey(episode, index), durationSeconds);
    }
  });

  fallbackEpisodes.forEach((episode, index) => {
    const durationSeconds = collectEpisodeDuration(episode);

    if (durationSeconds && durationSeconds > 0) {
      fallbackDurationMap.set(getEpisodeKey(episode, index), durationSeconds);
    }
  });

  const resolvedDurations = episodes
    .map((episode, index) => {
      const key = getEpisodeKey(episode, index);
      return primaryDurationMap.get(key) ?? fallbackDurationMap.get(key) ?? null;
    })
    .filter((durationSeconds): durationSeconds is number => {
      return typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0;
    });

  if (resolvedDurations.length === 0) {
    return null;
  }

  const totalSeconds = resolvedDurations.reduce((sum, durationSeconds) => sum + durationSeconds, 0);

  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }

  const episodeCount = episodes.length;
  const resolvedCount = resolvedDurations.length;
  const notes =
    episodeCount > 1
      ? resolvedCount < episodeCount
        ? "已按哔哩哔哩正片分集汇总时长，部分分集未返回时长。"
        : `已按哔哩哔哩正片 ${episodeCount} 集汇总时长。`
      : "已从哔哩哔哩正片信息中提取时长。";

  return {
    durationLabel: formatClockDuration(totalSeconds),
    durationSeconds: totalSeconds,
    episodeCount,
    notes,
    resolvedCount,
  };
}

async function fetchBilibiliJson(url: string, referer: string): Promise<BilibiliApiResponse | null> {
  const response = await fetch(url, {
    headers: buildRequestHeaders(referer),
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  try {
    return (await response.json()) as BilibiliApiResponse;
  } catch {
    return null;
  }
}

async function resolveSeasonIdFromMediaId(mediaId: string, referer: string): Promise<string | null> {
  const payload = await fetchBilibiliJson(
    `https://api.bilibili.com/pgc/review/user?media_id=${mediaId}`,
    referer,
  );

  const seasonId = payload?.code === 0 ? payload.result?.media?.season_id : null;
  return seasonId ? String(seasonId) : null;
}

async function fetchBilibiliBangumiDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const { seasonId, epId, mediaId } = extractBangumiIds(url);
  const resolvedSeasonId = seasonId ?? (mediaId ? await resolveSeasonIdFromMediaId(mediaId, url) : null);
  const query = resolvedSeasonId ? `season_id=${resolvedSeasonId}` : epId ? `ep_id=${epId}` : null;

  if (!query) {
    return {};
  }

  const viewPayload = await fetchBilibiliJson(`https://api.bilibili.com/pgc/view/web/season?${query}`, url);
  const viewEpisodes = viewPayload?.code === 0 ? viewPayload.result?.episodes ?? [] : [];

  if (viewEpisodes.length > 0) {
    const viewSummary = summarizeEpisodeDurations(viewEpisodes);

    if (viewSummary) {
      if (viewSummary.resolvedCount < viewSummary.episodeCount && resolvedSeasonId) {
        const sectionPayload = await fetchBilibiliJson(
          `https://api.bilibili.com/pgc/web/season/section?season_id=${resolvedSeasonId}`,
          url,
        );
        const mainSectionEpisodes =
          sectionPayload?.code === 0 ? sectionPayload.result?.main_section?.episodes ?? [] : [];

        const mergedSummary = summarizeEpisodeDurations(viewEpisodes, mainSectionEpisodes);
        if (mergedSummary) {
          return mergedSummary;
        }
      }

      return viewSummary;
    }
  }

  if (resolvedSeasonId) {
    const sectionPayload = await fetchBilibiliJson(
      `https://api.bilibili.com/pgc/web/season/section?season_id=${resolvedSeasonId}`,
      url,
    );
    const mainSectionEpisodes =
      sectionPayload?.code === 0 ? sectionPayload.result?.main_section?.episodes ?? [] : [];

    if (mainSectionEpisodes.length > 0) {
      const summary = summarizeEpisodeDurations(mainSectionEpisodes);
      if (summary) {
        return summary;
      }
    }
  }

  return {};
}

async function fetchBilibiliFallbackPageDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const mobileUrl = url.replace("https://www.bilibili.com/", "https://m.bilibili.com/");
  const response = await fetch(mobileUrl, {
    headers: buildRequestHeaders("https://movie.douban.com/"),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      notes: `哔哩哔哩页面请求失败：${response.status}`,
    };
  }

  const html = await response.text();
  const durationLabel =
    html.match(/VideoCover_durationItem[^>]*>(\d{2}:\d{2}:\d{2})</)?.[1] ??
    html.match(/>(\d{2}:\d{2}:\d{2})<\/div><div class="VideoCover_playCountItem/)?.[1];

  if (!durationLabel) {
    return {
      notes: "哔哩哔哩页面暂未解析到时长字段。",
    };
  }

  return {
    durationLabel,
    durationSeconds: parseClockToSeconds(durationLabel) ?? undefined,
    notes: "已从哔哩哔哩移动页展示信息中提取时长。",
  };
}

export async function fetchBilibiliDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const bangumiDuration = await fetchBilibiliBangumiDuration(url);

  if (bangumiDuration.durationSeconds) {
    return bangumiDuration;
  }

  return fetchBilibiliFallbackPageDuration(url);
}
