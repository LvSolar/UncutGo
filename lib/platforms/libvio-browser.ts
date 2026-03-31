import { existsSync } from "node:fs";

import { chromium } from "playwright-core";

import { parseDurationLabelToSeconds } from "./shared";

const chromePathCandidates = [
  process.env.LIBVIO_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : undefined,
].filter(Boolean) as string[];

const libvioUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const minimumFeatureSeconds = 20 * 60;
const maximumFeatureSeconds = 6 * 60 * 60;

function resolveChromeExecutablePath(): string | null {
  for (const candidate of chromePathCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function pickLongestClockDuration(text: string): {
  durationSeconds: number;
  durationLabel: string;
} | null {
  const matches = [...text.matchAll(/\b(\d{1,2}:\d{2}:\d{2})\b/g)];
  const candidates = matches
    .map((match) => {
      const durationLabel = match[1];
      const durationSeconds = parseDurationLabelToSeconds(durationLabel);

      if (!durationSeconds) {
        return null;
      }

      return {
        durationSeconds,
        durationLabel,
      };
    })
    .filter(Boolean) as Array<{
    durationSeconds: number;
    durationLabel: string;
  }>;

  const filtered = candidates.filter(
    (candidate) =>
      candidate.durationSeconds >= minimumFeatureSeconds &&
      candidate.durationSeconds <= maximumFeatureSeconds,
  );

  if (filtered.length === 0) {
    return null;
  }

  return [...filtered].sort((left, right) => right.durationSeconds - left.durationSeconds)[0];
}

export async function fetchLibvioDurationViaBrowser(playUrl: string): Promise<{
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}> {
  const executablePath = resolveChromeExecutablePath();

  if (!executablePath) {
    return {
      notes: "本机未找到可用于 Libvio 浏览器兜底的 Chrome。",
    };
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const page = await browser.newPage({
      userAgent: libvioUserAgent,
      locale: "zh-CN",
      viewport: {
        width: 1440,
        height: 900,
      },
    });

    await page.goto(playUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const iframeLocator = page.locator("#playleft iframe").first();
    await iframeLocator.waitFor({
      state: "attached",
      timeout: 30000,
    });

    const iframeHandle = await iframeLocator.elementHandle();
    const frame = await iframeHandle?.contentFrame();

    if (!frame) {
      return {
        notes: "Libvio 浏览器兜底已打开播放页，但暂时没有拿到播放器 iframe。",
      };
    }

    await frame.waitForLoadState("domcontentloaded", {
      timeout: 15000,
    }).catch(() => undefined);

    await frame
      .waitForFunction(() => /\d{2}:\d{2}:\d{2}/.test(document.body.innerText), {
        timeout: 30000,
      })
      .catch(() => undefined);

    const textFromBody = await frame.locator("body").innerText().catch(() => "");
    const duration = pickLongestClockDuration(textFromBody);

    if (!duration) {
      return {
        notes: "Libvio 浏览器兜底已进入播放器，但仍未识别到可信时长文本。",
      };
    }

    return {
      ...duration,
      notes: "已通过浏览器级渲染读取 Libvio 播放器中的时长。",
    };
  } catch (error) {
    return {
      notes:
        error instanceof Error
          ? `Libvio 浏览器兜底失败：${error.message}`
          : "Libvio 浏览器兜底失败。",
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
