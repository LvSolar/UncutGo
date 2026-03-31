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

const runtimePatterns = [
  /duration:"(\d{2}:\d{2}:\d{2})"/,
  /"duration":"(\d{2}:\d{2}:\d{2})"/,
  /tag_4\\":\{[^}]*text\\":\\"(\d{2}:\d{2}:\d{2})\\"/,
  /"text":"(\d{2}:\d{2}:\d{2})"/,
];

export async function fetchTencentDuration(url: string): Promise<{
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
      notes: `腾讯视频页面请求失败：${response.status}`,
    };
  }

  const html = await response.text();
  const durationLabel = runtimePatterns
    .map((pattern) => pattern.exec(html)?.[1])
    .find((value): value is string => Boolean(value));

  if (!durationLabel) {
    return {
      notes: "腾讯视频页面暂未解析到时长字段。",
    };
  }

  return {
    durationLabel,
    durationSeconds: parseClockToSeconds(durationLabel) ?? undefined,
    notes: "已从腾讯视频详情页脚本数据中提取时长。",
  };
}
