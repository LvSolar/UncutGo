import * as cheerio from "cheerio";

import {
  durationFromValue,
  findDurationAroundTitle,
  findDurationInLines,
  getBodyTextLines,
  readDurationFromMeta,
  readDurationFromScripts,
  trimMediaTitle,
} from "./shared";

const minimumFeatureSeconds = 20 * 60;
const maximumFeatureSeconds = 6 * 60 * 60;

function getPageTitle($: cheerio.CheerioAPI): string {
  const rawTitle =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("meta[name='title']").attr("content")?.trim() ||
    $("title").first().text().trim() ||
    $("h1").first().text().trim();

  return trimMediaTitle(rawTitle);
}

function decodeIqiyiTvid(url: string): string | null {
  const token = url.match(/\/[vwp]_([^./?]+)\.html/i)?.[1];

  if (!token) {
    return null;
  }

  const salt = (0x75706971676c).toString(2).split("").reverse();
  const bits = parseInt(token, 36).toString(2).split("").reverse();
  const merged: number[] = [];

  for (let index = 0; index < Math.max(bits.length, salt.length); index += 1) {
    const left = bits[index] ? Number(bits[index]) : 0;
    const right = salt[index] ? Number(salt[index]) : 0;
    merged.push(left ^ right);
  }

  let tvid = parseInt(merged.reverse().join(""), 2);

  if (!Number.isFinite(tvid) || tvid <= 0) {
    return null;
  }

  if (tvid < 900000) {
    tvid = 100 * (tvid + 900000);
  }

  return String(tvid);
}

async function fetchIqiyiDurationFromApi(tvid: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const response = await fetch(`https://pcw-api.iqiyi.com/video/video/baseinfo/${tvid}`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: "https://movie.douban.com/",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {};
  }

  const payload = (await response.json()) as {
    data?: {
      duration?: string;
      durationSec?: number;
    };
  };

  const durationLabel = payload.data?.duration;
  const durationSeconds = durationFromValue(payload.data?.durationSec ?? durationLabel);

  if (!durationSeconds || durationSeconds < minimumFeatureSeconds || durationSeconds > maximumFeatureSeconds) {
    return {};
  }

  return {
    durationSeconds,
    durationLabel,
    notes: "已从爱奇艺基础信息接口提取时长。",
  };
}

export async function fetchIqiyiDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const tvid = decodeIqiyiTvid(url);

  if (tvid) {
    const apiDuration = await fetchIqiyiDurationFromApi(tvid);

    if (apiDuration.durationSeconds) {
      return apiDuration;
    }
  }

  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: "https://movie.douban.com/",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      notes: `爱奇艺页面请求失败：${response.status}`,
    };
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const title = getPageTitle($);
  const lines = getBodyTextLines($);

  const metaDuration = readDurationFromMeta($, minimumFeatureSeconds, maximumFeatureSeconds);
  if (metaDuration) {
    return {
      ...metaDuration,
      notes: "已从爱奇艺页面 meta 信息中提取时长。",
    };
  }

  const scriptDuration = readDurationFromScripts(
    html,
    title,
    minimumFeatureSeconds,
    maximumFeatureSeconds,
  );
  if (scriptDuration) {
    return {
      ...scriptDuration,
      notes: "已从爱奇艺页面脚本数据中提取时长。",
    };
  }

  if (title) {
    const titleDuration = findDurationAroundTitle(
      lines,
      title,
      minimumFeatureSeconds,
      maximumFeatureSeconds,
    );

    if (titleDuration) {
      return {
        ...titleDuration,
        notes: "已从爱奇艺页面正文中匹配片名附近的时长。",
      };
    }
  }

  const pageDuration = findDurationInLines(lines, minimumFeatureSeconds, maximumFeatureSeconds);
  if (pageDuration) {
    return {
      ...pageDuration,
      notes: "已从爱奇艺页面正文中提取较长时长字段。",
    };
  }

  return {
    notes: "爱奇艺页面暂未解析到可信时长字段。",
  };
}
