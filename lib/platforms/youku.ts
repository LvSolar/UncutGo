import * as cheerio from "cheerio";

import {
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

export async function fetchYoukuDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
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
      notes: `优酷页面请求失败：${response.status}`,
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
      notes: "已从优酷页面 meta 信息中提取时长。",
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
      notes: "已从优酷页面脚本数据中提取时长。",
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
        notes: "已从优酷页面正文中匹配片名附近的时长。",
      };
    }
  }

  const pageDuration = findDurationInLines(lines, minimumFeatureSeconds, maximumFeatureSeconds);
  if (pageDuration) {
    return {
      ...pageDuration,
      notes: "已从优酷页面正文中提取较长时长字段。",
    };
  }

  return {
    notes: "优酷页面暂未解析到可信时长字段。",
  };
}
