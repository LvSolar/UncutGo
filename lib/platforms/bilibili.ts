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

export async function fetchBilibiliDuration(url: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const mobileUrl = url.replace("https://www.bilibili.com/", "https://m.bilibili.com/");
  const response = await fetch(mobileUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      referer: "https://movie.douban.com/",
    },
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
