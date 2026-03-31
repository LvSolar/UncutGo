import * as cheerio from "cheerio";

export interface DurationFetchResult {
  durationSeconds?: number;
  durationLabel?: string;
  notes?: string;
}

interface DurationMatch {
  durationSeconds: number;
  durationLabel: string;
}

const punctuationToStrip = /[\s\u3000"'`~!！?？,，.。:：;；、·\-_/\\|()[\]{}<>《》【】“”‘’]+/g;

export function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(punctuationToStrip, "");
}

export function trimMediaTitle(title: string): string {
  const cleaned = title.trim();

  if (!cleaned) {
    return "";
  }

  const suffixSplit = cleaned.split(/[-|｜]/).map((part) => part.trim()).filter(Boolean);
  if (suffixSplit.length > 0) {
    return suffixSplit[0];
  }

  return cleaned;
}

function parseClockLikeDuration(label: string): number | null {
  const cleaned = label.trim();

  const hmsMatch = cleaned.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hmsMatch) {
    return Number(hmsMatch[1]) * 3600 + Number(hmsMatch[2]) * 60 + Number(hmsMatch[3]);
  }

  const minuteSecondMatch = cleaned.match(/^(\d{2,3}):(\d{2})$/);
  if (minuteSecondMatch && Number(minuteSecondMatch[1]) >= 60) {
    return Number(minuteSecondMatch[1]) * 60 + Number(minuteSecondMatch[2]);
  }

  return null;
}

function parseIsoDuration(label: string): number | null {
  const isoMatch = label.trim().match(
    /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i,
  );

  if (!isoMatch) {
    return null;
  }

  const days = Number(isoMatch[1] ?? 0);
  const hours = Number(isoMatch[2] ?? 0);
  const minutes = Number(isoMatch[3] ?? 0);
  const seconds = Number(isoMatch[4] ?? 0);

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function parseChineseDuration(label: string): number | null {
  const cleaned = label.trim();

  const hourMinuteMatch = cleaned.match(/(\d+)\s*小时\s*(\d+)\s*分(?:钟)?/);
  if (hourMinuteMatch) {
    return Number(hourMinuteMatch[1]) * 3600 + Number(hourMinuteMatch[2]) * 60;
  }

  const minuteSecondMatch = cleaned.match(/(\d+)\s*分(?:钟)?\s*(\d+)\s*秒/);
  if (minuteSecondMatch) {
    return Number(minuteSecondMatch[1]) * 60 + Number(minuteSecondMatch[2]);
  }

  const minuteOnlyMatch = cleaned.match(/(\d+)\s*分(?:钟)?/);
  if (minuteOnlyMatch) {
    return Number(minuteOnlyMatch[1]) * 60;
  }

  return null;
}

export function parseDurationLabelToSeconds(label: string): number | null {
  return parseClockLikeDuration(label) ?? parseIsoDuration(label) ?? parseChineseDuration(label);
}

function normalizeDurationNumber(value: number): number {
  if (value >= 100000) {
    return Math.round(value / 1000);
  }

  return Math.round(value);
}

export function durationFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeDurationNumber(value);
  }

  if (typeof value === "string") {
    const parsedNumber = Number(value);

    if (!Number.isNaN(parsedNumber) && value.trim() !== "") {
      return normalizeDurationNumber(parsedNumber);
    }

    return parseDurationLabelToSeconds(value);
  }

  return null;
}

export function getBodyTextLines($: cheerio.CheerioAPI): string[] {
  return $("body")
    .text()
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function uniqueMatches(matches: DurationMatch[]): DurationMatch[] {
  const seen = new Set<string>();

  return matches.filter((match) => {
    const key = `${match.durationSeconds}:${match.durationLabel}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function collectDurationMatchesFromText(text: string): DurationMatch[] {
  const matches: DurationMatch[] = [];

  for (const match of text.matchAll(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/gi)) {
    const durationLabel = match[0];
    const durationSeconds = parseDurationLabelToSeconds(durationLabel);

    if (durationSeconds) {
      matches.push({ durationSeconds, durationLabel });
    }
  }

  for (const match of text.matchAll(/\b(\d{1,2}:\d{2}:\d{2})\b/g)) {
    const durationLabel = match[1];
    const durationSeconds = parseDurationLabelToSeconds(durationLabel);

    if (durationSeconds) {
      matches.push({ durationSeconds, durationLabel });
    }
  }

  for (const match of text.matchAll(/\b(\d{2,3}:\d{2})\b/g)) {
    const durationLabel = match[1];
    const durationSeconds = parseDurationLabelToSeconds(durationLabel);

    if (durationSeconds) {
      matches.push({ durationSeconds, durationLabel });
    }
  }

  for (const match of text.matchAll(/(\d+\s*小时\s*\d+\s*分(?:钟)?)|(\d+\s*分(?:钟)?\s*\d+\s*秒)|(\d+\s*分(?:钟)?)/g)) {
    const durationLabel = match[0];
    const durationSeconds = parseDurationLabelToSeconds(durationLabel);

    if (durationSeconds) {
      matches.push({ durationSeconds, durationLabel });
    }
  }

  return uniqueMatches(matches);
}

function pickBestDurationMatch(
  matches: DurationMatch[],
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): DurationMatch | null {
  const filtered = matches.filter(
    (match) =>
      match.durationSeconds >= minimumSeconds && match.durationSeconds <= maximumSeconds,
  );

  if (filtered.length === 0) {
    return null;
  }

  return [...filtered].sort((left, right) => right.durationSeconds - left.durationSeconds)[0];
}

export function findBestDurationInText(
  text: string,
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): { durationSeconds: number; durationLabel: string } | null {
  return pickBestDurationMatch(collectDurationMatchesFromText(text), minimumSeconds, maximumSeconds);
}

export function findDurationAroundTitle(
  lines: string[],
  title: string,
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): { durationSeconds: number; durationLabel: string } | null {
  const normalizedTitle = normalizeForMatch(title);

  if (!normalizedTitle) {
    return null;
  }

  const matches = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => normalizeForMatch(line).includes(normalizedTitle));

  if (matches.length === 0) {
    return null;
  }

  const lastMatch = matches[matches.length - 1];
  const windowStart = Math.max(0, lastMatch.index - 2);
  const windowEnd = Math.min(lines.length, lastMatch.index + 6);
  const windowText = lines.slice(windowStart, windowEnd).join("\n");

  return findBestDurationInText(windowText, minimumSeconds, maximumSeconds);
}

export function findDurationInLines(
  lines: string[],
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): { durationSeconds: number; durationLabel: string } | null {
  return findBestDurationInText(lines.join("\n"), minimumSeconds, maximumSeconds);
}

export function readDurationFromMeta(
  $: cheerio.CheerioAPI,
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): {
  durationSeconds: number;
  durationLabel: string;
} | null {
  const metaNodes = $("meta").toArray();
  const matches: DurationMatch[] = [];

  for (const node of metaNodes) {
    const property = $(node).attr("property")?.trim().toLowerCase() ?? "";
    const name = $(node).attr("name")?.trim().toLowerCase() ?? "";
    const itemprop = $(node).attr("itemprop")?.trim().toLowerCase() ?? "";
    const content = $(node).attr("content")?.trim() ?? "";
    const key = `${property} ${name} ${itemprop}`;

    if (!content || !/(duration|runtime|length)/.test(key)) {
      continue;
    }

    const durationSeconds = durationFromValue(content);

    if (durationSeconds) {
      matches.push({
        durationSeconds,
        durationLabel: content,
      });
    }
  }

  return pickBestDurationMatch(matches, minimumSeconds, maximumSeconds);
}

function collectExplicitScriptDurationMatches(scriptText: string): DurationMatch[] {
  const matches: DurationMatch[] = [];
  const explicitPatterns = [
    /["'](?:duration|videoDuration|playDuration|timeLength|timelength|durationSeconds|videoTimeLength|seconds)["']\s*:\s*["']?([^"',}\s]+)/gi,
  ];

  for (const pattern of explicitPatterns) {
    for (const match of scriptText.matchAll(pattern)) {
      const rawValue = match[1];
      const durationSeconds = durationFromValue(rawValue);

      if (durationSeconds) {
        matches.push({
          durationSeconds,
          durationLabel: String(rawValue),
        });
      }
    }
  }

  return uniqueMatches(matches);
}

function collectScriptDurationMatches(scriptText: string): DurationMatch[] {
  const explicitMatches = collectExplicitScriptDurationMatches(scriptText);

  if (explicitMatches.length > 0) {
    return explicitMatches;
  }

  return collectDurationMatchesFromText(scriptText);
}

export function readDurationFromScripts(
  html: string,
  title?: string,
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): { durationSeconds: number; durationLabel: string } | null {
  const scriptTexts = html
    .match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)
    ?.map((script) => script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, ""))
    ?? [];

  const normalizedTitle = title ? normalizeForMatch(title) : "";

  const scanScripts = (requireTitleMatch: boolean) => {
    const matches: DurationMatch[] = [];

    for (const scriptText of scriptTexts) {
      const normalizedScript = normalizeForMatch(scriptText);

      if (requireTitleMatch && title && normalizedTitle && !normalizedScript.includes(normalizedTitle)) {
        continue;
      }

      matches.push(...collectScriptDurationMatches(scriptText));
    }

    return pickBestDurationMatch(matches, minimumSeconds, maximumSeconds);
  };

  return scanScripts(true) ?? scanScripts(false);
}
