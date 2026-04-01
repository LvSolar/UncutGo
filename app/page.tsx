"use client";

import { startTransition, useEffect, useRef, useState } from "react";

import CinemaCursor from "./cinema-cursor";
import ParticleBackdrop from "./particle-backdrop";
import { formatDuration } from "../lib/utils/time";
import type { AnalysisReport, CandidateMovie, JudgedPlatformOffer, MoviePreview } from "../types/movie";

const verdictToneClasses: Record<string, string> = {
  大概率无删减: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  可能无删减: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  版本不一致: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  可能删减: "border-orange-400/30 bg-orange-400/10 text-orange-100",
  疑似删减: "border-rose-400/30 bg-rose-400/10 text-rose-100",
  信息不足: "border-white/12 bg-white/6 text-white/68",
};

const stateToneClasses: Record<string, string> = {
  分析中: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  实时结果: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  缓存结果: "border-white/12 bg-white/6 text-white/72",
  样例数据: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  浏览器兜底: "border-sky-300/30 bg-sky-300/10 text-sky-100",
  已获取片长: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  真实媒体时长: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  站内已匹配: "border-white/12 bg-white/6 text-white/72",
  未搜到片源: "border-white/12 bg-white/6 text-white/72",
  无播放入口: "border-white/12 bg-white/6 text-white/72",
  时长待确认: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  豆瓣实时搜索: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  样例候选: "border-amber-300/30 bg-amber-300/10 text-amber-100",
};

const badgeToneClasses = {
  gold: "border-[#d8b56a]/35 bg-[#d8b56a]/12 text-[#f7e7b7]",
  slate: "border-white/12 bg-white/6 text-white/72",
  emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
  rose: "border-rose-400/30 bg-rose-400/10 text-rose-100",
} as const;

const SEARCH_STEPS = ["放映检索中", "翻看片单中", "对齐豆瓣中"];
const ANALYSIS_STEPS = ["读取豆瓣版本", "比对平台片长", "生成删减判断"];
const ANALYSIS_CHIPS = ["豆瓣", "腾讯", "B站", "爱奇艺", "优酷", "Libvio"];
const verdictPriority = {
  大概率无删减: 5,
  可能无删减: 4,
  版本不一致: 3,
  信息不足: 2,
  可能删减: 1,
  疑似删减: 0,
} as const;

const platformSortOptions = [
  { id: "recommended", label: "推荐顺序" },
  { id: "delta", label: "误差最小" },
  { id: "name", label: "平台名称" },
] as const;
const platformFilterOptions = [
  { id: "all", label: "全部平台" },
  { id: "likely", label: "更可能完整" },
  { id: "runtime", label: "已拿到片长" },
] as const;
const RECENT_QUERIES_STORAGE_KEY = "uncutgo-recent-queries";

type SearchResponse = {
  candidates: CandidateMovie[];
  mode?: "idle" | "live" | "mock-fallback";
  warning?: string;
};

type AnalysisStreamMessage = {
  type: "progress" | "complete";
  report: AnalysisReport;
  completed: number;
  total: number;
};

type PlatformSortMode = (typeof platformSortOptions)[number]["id"];
type PlatformFilterMode = (typeof platformFilterOptions)[number]["id"];

function upsertRecentQuery(items: string[], nextQuery: string): string[] {
  const normalized = nextQuery.trim();
  if (!normalized) return items;

  return [normalized, ...items.filter((item) => item !== normalized)].slice(0, 6);
}

function joinClasses(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function formatScore(value?: number): string {
  if (!value || Number.isNaN(value)) {
    return "暂无评分";
  }

  return Number(value).toFixed(1);
}

function hasBrowserFallback(report: AnalysisReport): boolean {
  return report.platforms.some((platform) => platform.notes?.includes("浏览器级渲染"));
}

function getReportStateBadges(report: AnalysisReport): string[] {
  const badges = [report.status === "live" ? "实时结果" : "样例数据"];

  if (report.cache === "hit") {
    badges.push("缓存结果");
  }

  if (hasBrowserFallback(report)) {
    badges.push("浏览器兜底");
  }

  return badges;
}

function getPlatformState(platform: JudgedPlatformOffer): string {
  const notes = platform.notes ?? "";

  if (notes.includes("浏览器级渲染")) return "浏览器兜底";
  if (platform.durationSeconds) {
    if (notes.includes("m3u8") || notes.includes("真实媒体地址")) return "真实媒体时长";
    return "已获取片长";
  }
  if (!platform.available && notes.includes("暂未找到匹配电影")) return "未搜到片源";
  if (platform.available && notes.includes("暂未识别到可播放入口")) return "无播放入口";
  if (platform.available || notes.includes("已定位到播放页") || notes.includes("已搜索到匹配电影")) return "时长待确认";
  return "站内已匹配";
}

function getPlatformQuickReason(platform: JudgedPlatformOffer): string {
  const state = getPlatformState(platform);

  if (platform.durationSeconds && typeof platform.deltaSeconds === "number") {
    if (platform.deltaSeconds === 0) {
      return "与基准一致";
    }

    if (platform.deltaSeconds > 0) {
      return `比基准长 ${platform.deltaSeconds} 秒`;
    }

    return `比基准短 ${Math.abs(platform.deltaSeconds)} 秒`;
  }

  switch (state) {
    case "未搜到片源":
      return "站内未搜到片源";
    case "无播放入口":
      return "已找到条目，暂无播放入口";
    case "时长待确认":
      return "已定位条目，待解析片长";
    case "浏览器兜底":
      return "已走浏览器兜底";
    case "真实媒体时长":
      return "已拿到真实媒体时长";
    case "已获取片长":
      return "已拿到可信片长";
    default:
      return "已匹配到站内条目";
  }
}

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function candidateToPreview(candidate: CandidateMovie | null): MoviePreview | null {
  if (!candidate) return null;

  return {
    id: candidate.id,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    year: candidate.year,
    director: candidate.director,
    doubanRating: candidate.doubanRating ?? 0,
    doubanUrl: candidate.doubanUrl,
    summary: "",
    posterUrl: candidate.posterUrl,
  };
}

function getRecommendationSummary(report: AnalysisReport): {
  eyebrow: string;
  headline: string;
  body: string;
  tone: keyof typeof badgeToneClasses;
} {
  if (report.platforms.length === 0) {
    return {
      eyebrow: "本次结论",
      headline: "当前没找到合适的国内片源",
      body: "这不是报错，而是正式结果。",
      tone: "slate",
    };
  }

  const rankedPlatforms = [...report.platforms].sort((left, right) => {
    const verdictGap = verdictPriority[right.verdict] - verdictPriority[left.verdict];
    if (verdictGap !== 0) return verdictGap;
    return Math.abs(left.deltaSeconds ?? 999999) - Math.abs(right.deltaSeconds ?? 999999);
  });
  const domesticPlatforms = rankedPlatforms.filter((platform) => platform.platform !== "Libvio");
  const libvioPlatform = rankedPlatforms.find((platform) => platform.platform === "Libvio");

  if (domesticPlatforms.length === 0 && libvioPlatform) {
    if (libvioPlatform.available) {
      return {
        eyebrow: "推荐观看",
        headline: "国内无播放源时，推荐 Libvio 观看",
        body: libvioPlatform.durationSeconds
          ? "Libvio 已找到可播放入口，这次优先推荐从 Libvio 继续看。"
          : "Libvio 已找到可继续查看的跳转页，这次优先推荐从 Libvio 继续查。",
        tone: "gold",
      };
    }

    return {
      eyebrow: "国内片源",
      headline: "豆瓣暂无国内播放源",
      body: "已额外检查 Libvio；无论有无片源，下方都会保留 Libvio 跳转页。",
      tone: "slate",
    };
  }

  const positivePlatforms = rankedPlatforms.filter((platform) => verdictPriority[platform.verdict] >= 4);
  if (positivePlatforms.length > 0) {
    const names = positivePlatforms.slice(0, 2).map((platform) => platform.platform).join("、");
    return {
      eyebrow: "放映建议",
      headline: `优先看 ${names}`,
      body: "这些平台和当前参考版本最接近。",
      tone: "emerald",
    };
  }

  const variantPlatform = rankedPlatforms.find((platform) => platform.verdict === "版本不一致");
  if (variantPlatform) {
    return {
      eyebrow: "放映建议",
      headline: `${variantPlatform.platform} 更像另一发行版本`,
      body: "它不一定是删减，更像另一条合法片长线索。",
      tone: "gold",
    };
  }

  if (rankedPlatforms.every((platform) => platform.verdict === "信息不足")) {
    return {
      eyebrow: "本次结论",
      headline: "这次还拿不到稳定结论",
      body: "已识别的平台还缺可信片长。",
      tone: "slate",
    };
  }

  return {
    eyebrow: "放映建议",
    headline: "这次没有理想片源",
    body: "已识别的平台整体更短，建议再等等。",
    tone: "rose",
  };
}

function getPlatformActionLabel(platform: JudgedPlatformOffer): string {
  if (platform.platform === "Libvio") {
    return platform.available ? "打开Libvio" : "打开搜索页";
  }

  return platform.available ? "打开平台页" : "打开线索页";
}

function getVersionPriorityLabel(tag: AnalysisReport["preferredVersion"]["tag"]): string {
  switch (tag) {
    case "director-cut":
      return "导演剪辑版";
    case "festival":
      return "电影节版本";
    case "international":
      return "国际版本";
    case "extended":
      return "加长版本";
    case "restored":
      return "修复版本";
    case "mainland":
      return "中国大陆版本";
    default:
      return "当前版本";
  }
}

function getPreferredVersionReason(
  preferredVersion: AnalysisReport["preferredVersion"],
  alternateVersions: AnalysisReport["alternateVersions"],
): string {
  const sameTagVersions = [preferredVersion, ...alternateVersions].filter(
    (version) => version.tag === preferredVersion.tag,
  );
  const hasShorterSameTagVersion = sameTagVersions.some(
    (version) =>
      version.id !== preferredVersion.id &&
      version.durationSeconds < preferredVersion.durationSeconds,
  );

  if (preferredVersion.tag === "director-cut") {
    return hasShorterSameTagVersion
      ? "已优先选择导演剪辑版；同类版本里再按更长片长作为基准。"
      : "已优先选择导演剪辑版作为当前比对基准。";
  }

  if (preferredVersion.tag === "festival") {
    return hasShorterSameTagVersion
      ? "已优先选择电影节版本；同类版本里再按更长片长作为基准。"
      : "已优先选择电影节版本作为当前比对基准。";
  }

  if (preferredVersion.tag === "international") {
    return hasShorterSameTagVersion
      ? "已优先选择国际版本；同类版本里再按更长片长作为基准。"
      : "已优先选择国际版本作为当前比对基准。";
  }

  if (hasShorterSameTagVersion) {
    return `当前按${getVersionPriorityLabel(preferredVersion.tag)}中更长的片长作为基准。`;
  }

  return `当前按${getVersionPriorityLabel(preferredVersion.tag)}作为比对基准。`;
}

function sortPlatforms(platforms: JudgedPlatformOffer[], sortMode: PlatformSortMode): JudgedPlatformOffer[] {
  const ranked = [...platforms];

  if (sortMode === "name") {
    return ranked.sort((left, right) => left.platform.localeCompare(right.platform, "zh-CN"));
  }

  if (sortMode === "delta") {
    return ranked.sort((left, right) => {
      const leftDelta = Math.abs(left.deltaSeconds ?? Number.POSITIVE_INFINITY);
      const rightDelta = Math.abs(right.deltaSeconds ?? Number.POSITIVE_INFINITY);
      if (leftDelta !== rightDelta) return leftDelta - rightDelta;
      return verdictPriority[right.verdict] - verdictPriority[left.verdict];
    });
  }

  return ranked.sort((left, right) => {
    const verdictGap = verdictPriority[right.verdict] - verdictPriority[left.verdict];
    if (verdictGap !== 0) return verdictGap;

    const leftDelta = Math.abs(left.deltaSeconds ?? Number.POSITIVE_INFINITY);
    const rightDelta = Math.abs(right.deltaSeconds ?? Number.POSITIVE_INFINITY);
    if (leftDelta !== rightDelta) return leftDelta - rightDelta;

    return left.platform.localeCompare(right.platform, "zh-CN");
  });
}

function filterPlatforms(platforms: JudgedPlatformOffer[], filterMode: PlatformFilterMode): JudgedPlatformOffer[] {
  if (filterMode === "likely") {
    return platforms.filter((platform) => verdictPriority[platform.verdict] >= 4);
  }

  if (filterMode === "runtime") {
    return platforms.filter((platform) => Boolean(platform.durationSeconds));
  }

  return platforms;
}

function ToneBadge({
  children,
  tone = "slate",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof badgeToneClasses;
  className?: string;
}) {
  return (
    <span
      className={joinClasses(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase",
        badgeToneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

function CandidateSkeletonStrip() {
  return (
    <div className="stage-panel overflow-hidden rounded-[1.2rem]">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className={joinClasses(
            "film-loader px-4 py-3",
            index < 2 ? "border-b border-white/8" : "",
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2 py-1">
              <div className="h-3 w-16 rounded-full bg-white/8" />
              <div className="h-5 w-2/5 rounded-full bg-white/10" />
              <div className="h-4 w-1/3 rounded-full bg-white/6" />
            </div>
            <div className="flex w-32 gap-2">
              <div className="h-7 flex-1 rounded-full bg-white/8" />
              <div className="h-7 flex-1 rounded-full bg-white/6" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultLoadingScene({ preview, stepIndex }: { preview: MoviePreview | null; stepIndex: number }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">
          <ToneBadge tone="gold">分析中</ToneBadge>
          {ANALYSIS_CHIPS.map((label, index) => (
            <span
              key={label}
              className={joinClasses(
                "scan-chip rounded-full border px-2.5 py-1 text-[10px] text-white/62",
                index <= stepIndex ? "border-[#d8b56a]/35 bg-[#d8b56a]/12 text-[#f8ecc7]" : "border-white/10 bg-white/[0.03]",
              )}
            >
              {label}
            </span>
          ))}
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.26em] text-white/40">当前阶段</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">{ANALYSIS_STEPS[stepIndex % ANALYSIS_STEPS.length]}</h3>
        </div>
        <p className="text-sm leading-6 text-white/60">
          {preview ? `正在为《${preview.title}》整理版本和平台线索。` : "正在整理版本和平台线索。"}
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CandidateMovie[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, MoviePreview>>({});
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<{ completed: number; total: number } | null>(null);
  const [platformSortMode, setPlatformSortMode] = useState<PlatformSortMode>("recommended");
  const [platformFilterMode, setPlatformFilterMode] = useState<PlatformFilterMode>("all");
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const previewRequestsRef = useRef(new Map<string, Promise<MoviePreview | null>>());
  const analysisRequestsRef = useRef(new Map<string, Promise<AnalysisReport>>());
  const searchAbortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const analysisRunIdRef = useRef(0);
  const candidateSectionRef = useRef<HTMLElement | null>(null);
  const resultSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });

      const stored = window.localStorage.getItem(RECENT_QUERIES_STORAGE_KEY);
      if (!stored) return;

      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed)) {
        setRecentQueries(parsed.filter((item) => typeof item === "string").slice(0, 6));
      }
    } catch {
      // Ignore malformed local history and continue with an empty list.
    }
  }, []);

  useEffect(() => {
    if (!searching && !analyzing) {
      setLoadingStep(0);
      return;
    }

    setLoadingStep(0);
    const steps = searching ? SEARCH_STEPS : ANALYSIS_STEPS;
    const intervalId = window.setInterval(() => {
      setLoadingStep((current) => (current + 1) % steps.length);
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [searching, analyzing]);

  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
      analysisAbortRef.current?.abort();
    },
    [],
  );

  async function loadPreview(movieId: string): Promise<MoviePreview | null> {
    if (previews[movieId]) return previews[movieId];

    const inflightRequest = previewRequestsRef.current.get(movieId);
    if (inflightRequest) return inflightRequest;

    const request = fetch(`/api/preview?id=${encodeURIComponent(movieId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("preview fetch failed");
        return (await response.json()) as MoviePreview;
      })
      .then((preview) => {
        startTransition(() => {
          setPreviews((current) => ({ ...current, [movieId]: preview }));
        });
        return preview;
      })
      .catch(() => null)
      .finally(() => {
        previewRequestsRef.current.delete(movieId);
      });

    previewRequestsRef.current.set(movieId, request);
    return request;
  }

  function rememberRecentQuery(nextQuery: string) {
    startTransition(() => {
      setRecentQueries((current) => {
        const updated = upsertRecentQuery(current, nextQuery);

        try {
          window.localStorage.setItem(RECENT_QUERIES_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore storage failures and keep the in-memory list.
        }

        return updated;
      });
    });
  }

  async function fetchAnalysisReport(
    movieId: string,
    options?: { force?: boolean; signal?: AbortSignal },
  ): Promise<AnalysisReport> {
    const shouldForce = Boolean(options?.force);
    const inflightRequest = shouldForce ? null : analysisRequestsRef.current.get(movieId);
    if (inflightRequest) {
      return inflightRequest;
    }

    const request = fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ movieId, force: shouldForce }),
      signal: options?.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("analysis failed");
        }

        return (await response.json()) as AnalysisReport;
      })
      .finally(() => {
        if (!shouldForce) {
          analysisRequestsRef.current.delete(movieId);
        }
      });

    if (!shouldForce) {
      analysisRequestsRef.current.set(movieId, request);
    }
    return request;
  }

  async function streamAnalysisReport(
    movieId: string,
    options?: {
      force?: boolean;
      signal?: AbortSignal;
      onMessage?: (message: AnalysisStreamMessage) => void;
    },
  ): Promise<AnalysisReport> {
    const response = await fetch(
      `/api/analyze/stream?movieId=${encodeURIComponent(movieId)}${options?.force ? "&force=1" : ""}`,
      { signal: options?.signal },
    );

    if (!response.ok || !response.body) {
      throw new Error("analysis stream failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalReport: AnalysisReport | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const message = JSON.parse(line) as AnalysisStreamMessage;
        finalReport = message.report;
        options?.onMessage?.(message);
      }
    }

    if (buffer.trim()) {
      const message = JSON.parse(buffer) as AnalysisStreamMessage;
      finalReport = message.report;
      options?.onMessage?.(message);
    }

    if (!finalReport) {
      throw new Error("analysis stream empty");
    }

    return finalReport;
  }

  async function runSearch(rawQuery: string) {
    const normalizedQuery = rawQuery.trim();
    if (!normalizedQuery) return;

    analysisRunIdRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    searchAbortRef.current?.abort();

    const controller = new AbortController();
    searchAbortRef.current = controller;

    setSearching(true);
    setAnalyzing(false);
    setReport(null);
    setSelectedId(null);
    setAnalysisProgress(null);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}`, {
        signal: controller.signal,
      });
      const data = (await response.json()) as SearchResponse;

      startTransition(() => {
        setCandidates(data.candidates);
      });
      rememberRecentQuery(normalizedQuery);

      void Promise.allSettled(data.candidates.slice(0, 4).map((candidate) => loadPreview(candidate.id)));
      if (data.candidates.length === 1) {
        void handleAnalyze(data.candidates[0].id);
      } else {
        window.requestAnimationFrame(() => {
          candidateSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      startTransition(() => {
        setCandidates([]);
      });
    } finally {
      const isLatestSearch = searchAbortRef.current === controller;
      if (isLatestSearch) {
        searchAbortRef.current = null;
        setSearching(false);
      }
    }
  }

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query);
  }

  function stopAnalysis() {
    analysisRunIdRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalyzing(false);
    setAnalysisProgress(null);
  }

  async function handleAnalyze(movieId: string, options?: { force?: boolean }) {
    const shouldForce = Boolean(options?.force);
    const runId = analysisRunIdRef.current + 1;
    analysisRunIdRef.current = runId;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;

    setSelectedId(movieId);
    setAnalyzing(true);
    setAnalysisProgress(null);
    void loadPreview(movieId);
    window.requestAnimationFrame(() => {
      resultSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    try {
      const data =
        !shouldForce && analysisRequestsRef.current.has(movieId)
          ? await fetchAnalysisReport(movieId, { signal: controller.signal })
          : await streamAnalysisReport(movieId, {
              force: shouldForce,
              signal: controller.signal,
              onMessage: (message) => {
                if (runId !== analysisRunIdRef.current) {
                  return;
                }

                startTransition(() => {
                  setReport(message.report);
                  setAnalysisProgress({ completed: message.completed, total: message.total });
                });
              },
            });

      if (runId !== analysisRunIdRef.current) {
        return;
      }

      startTransition(() => {
        setReport(data);
      });

    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      if (runId !== analysisRunIdRef.current) {
        return;
      }
    } finally {
      if (analysisAbortRef.current === controller) {
        analysisAbortRef.current = null;
      }
      if (runId === analysisRunIdRef.current) {
        setAnalyzing(false);
      }
    }
  }

  const selectedCandidate = selectedId ? candidates.find((candidate) => candidate.id === selectedId) ?? null : null;
  const selectedPreview = selectedId ? previews[selectedId] ?? candidateToPreview(selectedCandidate) : null;
  const resultPreview = report
    ? {
        id: report.movie.id,
        title: report.movie.title,
        originalTitle: report.movie.originalTitle,
        year: report.movie.year,
        director: report.movie.director,
        doubanRating: report.movie.doubanRating,
        doubanUrl: report.movie.doubanUrl,
        summary: report.movie.summary,
        posterUrl: report.movie.posterUrl,
      }
    : selectedPreview;
  const reportSummary = report ? getRecommendationSummary(report) : null;
  const dedupedAlternateVersions = report
    ? report.alternateVersions.filter(
        (version) =>
          !(
            version.label === report.preferredVersion.label &&
            version.durationSeconds === report.preferredVersion.durationSeconds &&
            version.source === report.preferredVersion.source
          ),
      )
    : [];
  const sortedPlatforms = report ? sortPlatforms(report.platforms, platformSortMode) : [];
  const visiblePlatforms = filterPlatforms(sortedPlatforms, platformFilterMode);

  return (
    <main className="relative isolate min-h-screen overflow-x-clip cursor-none pb-12 text-white">
      <CinemaCursor />
      <ParticleBackdrop />

      <section className="relative z-10 border-b border-white/10">
        <div className="pointer-events-none absolute inset-x-[16%] top-12 h-[18rem] rounded-full bg-black/34 blur-3xl" />
        <div className="ambient-beam absolute left-[-10%] top-[-12%] h-[28rem] w-[28rem] rounded-full bg-[#f0bb63]/10 blur-3xl" />
        <div className="ambient-beam absolute right-[-8%] top-[8%] h-[22rem] w-[22rem] rounded-full bg-[#6a1930]/24 blur-3xl" />

        <div className="mx-auto max-w-6xl px-5 py-5 sm:px-8 lg:px-10 lg:py-6">
          <div className="cinema-fade-up flex flex-col items-center gap-5 text-center">
            <div className="inline-flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/6 px-4 py-2 text-sm text-white/74 backdrop-blur-sm">
              <span className="h-2.5 w-2.5 rounded-full bg-[#d8b56a] shadow-[0_0_18px_rgba(216,181,106,0.85)]" />
              UncutGo
            </div>

            <div className="mx-auto w-full max-w-[50rem] text-center">
              <p className="step-section-title">第 1 步</p>
              <h2 className="step-section-heading mt-2">片名 / 豆瓣链接</h2>
            </div>

            <form className="w-full max-w-[50rem] space-y-2.5" onSubmit={handleSearch}>
              <label className="sr-only" htmlFor="movie-query">
                片名 / 豆瓣链接
              </label>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,30rem)_10.5rem] lg:justify-center">
                <input
                  id="movie-query"
                  list="recent-query-suggestions"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例如：教父 / 杀手没有假期 / 豆瓣链接"
                  className="min-h-14 rounded-[1.15rem] border border-white/12 bg-white/[0.06] px-4 text-base text-white outline-none placeholder:text-white/34 focus:border-[#d8b56a]/45 focus:bg-white/[0.08]"
                />
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="min-h-14 rounded-[1.15rem] bg-[#d8b56a] px-5 text-base font-semibold text-[#1f1408] shadow-[0_14px_36px_rgba(216,181,106,0.22)] hover:bg-[#e4c583] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {searching ? SEARCH_STEPS[loadingStep % SEARCH_STEPS.length] : "查询"}
                </button>
              </div>
              <datalist id="recent-query-suggestions">
                {recentQueries.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </form>

            {recentQueries.length > 0 ? (
              <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-white/58">
                <span className="text-[11px] uppercase tracking-[0.24em] text-white/34">最近搜索</span>
                {recentQueries.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setQuery(item);
                      void runSearch(item);
                    }}
                    className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-sm text-white/68 transition hover:border-[#d8b56a]/28 hover:text-[#f6e5bb]"
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section ref={candidateSectionRef} className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/28 to-transparent" />
          <div className="mx-auto mb-4 w-full max-w-[50rem] text-center">
            <p className="step-section-title">第 2 步</p>
            <h2 className="step-section-heading mt-2">选择电影</h2>
            {candidates.length > 0 ? <p className="mt-3 text-sm text-white/50">{candidates.length} 部候选</p> : null}
          </div>
        <div className="mb-4 h-px bg-gradient-to-r from-white/12 via-white/6 to-transparent" />

        {searching ? (
          <div className="mx-auto w-full max-w-[50rem]">
            <CandidateSkeletonStrip />
          </div>
        ) : candidates.length === 0 ? (
          <div className="mx-auto w-full max-w-[50rem]">
            <div className="stage-panel rounded-[1.4rem] border border-dashed border-white/12 px-5 py-6 text-sm text-white/56">
              输入电影，开始这次放映前检查。
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[50rem]">
            <div className="stage-panel overflow-hidden rounded-[1.2rem]">
            {candidates.map((candidate) => {
              const preview = previews[candidate.id];
              const isSelected = selectedId === candidate.id;

              return (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => void handleAnalyze(candidate.id)}
                  onMouseEnter={() => {
                    void loadPreview(candidate.id);
                  }}
                  onFocus={() => {
                    void loadPreview(candidate.id);
                  }}
                  className={joinClasses(
                    "film-card w-full border-b border-white/8 px-4 py-3 text-left transition duration-300 last:border-b-0",
                    isSelected
                      ? "bg-[#d8b56a]/10"
                      : "bg-white/[0.02] hover:bg-white/[0.05]",
                  )}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={joinClasses("text-[11px] uppercase tracking-[0.24em]", isSelected ? "text-[#f3d999]" : "text-white/34")}>
                          {isSelected ? "已选中" : "候选"}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-white/24">/</span>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-white/34">{candidate.year || "年份待定"}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-end gap-x-3 gap-y-1">
                        <h3 className="truncate font-display text-[1.55rem] leading-none text-white">{candidate.title}</h3>
                        {candidate.originalTitle ? <p className="truncate text-sm text-white/42">{candidate.originalTitle}</p> : null}
                      </div>
                      <p className="mt-2 truncate text-sm text-white/58">导演：{preview?.director || candidate.director}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      {candidate.doubanRating ? <ToneBadge tone="slate">豆瓣 {formatScore(candidate.doubanRating)}</ToneBadge> : null}
                      <ToneBadge tone={isSelected ? "gold" : "slate"}>{isSelected ? "继续查看" : "点此分析"}</ToneBadge>
                    </div>
                  </div>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </section>

      <section ref={resultSectionRef} className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/30 to-transparent" />
        <div className="mx-auto mb-4 w-full max-w-[50rem] text-center">
          <p className="step-section-title">第 3 步</p>
          <h2 className="step-section-heading mt-2">时长对比</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {selectedId ? (
              <button
                type="button"
                onClick={() => void handleAnalyze(selectedId, { force: true })}
                disabled={searching}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/72 transition hover:border-[#d8b56a]/30 hover:text-[#f5dfaf] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {analyzing ? "重新抓取中" : "重新抓取"}
              </button>
            ) : null}
            {analyzing ? (
              <button
                type="button"
                onClick={stopAnalysis}
                className="rounded-full border border-rose-400/25 bg-rose-400/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-rose-100 transition hover:border-rose-300/35 hover:bg-rose-400/14"
              >
                停止分析
              </button>
            ) : null}
            {report ? <ToneBadge tone="slate">更新于 {formatGeneratedAt(report.generatedAt)}</ToneBadge> : null}
          </div>
        </div>
        <div className="mb-4 h-px bg-gradient-to-r from-white/12 via-white/6 to-transparent" />

        <div className="grid gap-4 xl:grid-cols-[18.5rem_minmax(0,1fr)]">
          <aside className="stage-panel rounded-[1.35rem] p-4">
            {resultPreview ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-display text-[1.9rem] leading-none text-white">{resultPreview.title}</h3>
                  <p className="text-sm text-white/50">{resultPreview.originalTitle || resultPreview.year}</p>
                </div>
                <dl className="space-y-2 border-y border-white/8 py-3 text-sm text-white/62">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-white/40">年份</dt>
                    <dd>{resultPreview.year || "待确认"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-white/40">导演</dt>
                    <dd className="truncate text-right">{resultPreview.director || "待确认"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-white/40">豆瓣</dt>
                    <dd>{formatScore(resultPreview.doubanRating)}</dd>
                  </div>
                </dl>
                {resultPreview.summary ? (
                  <div className="space-y-2">
                    <p className="text-[11px] uppercase tracking-[0.24em] text-white/38">剧情简介</p>
                    <p className="line-clamp-12 text-sm leading-6 text-white/62">{resultPreview.summary}</p>
                  </div>
                ) : null}
                {report ? (
                  <a
                    href={report.movie.doubanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-fit items-center rounded-full border border-white/12 px-3 py-2 text-sm text-white/74 hover:border-[#d8b56a]/35 hover:text-[#f6e8bf]"
                  >
                    打开豆瓣页面
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="space-y-4 text-white/56">
                <ToneBadge tone="slate">还没开片</ToneBadge>
                <p className="text-sm leading-7">先从上面选一部电影。</p>
              </div>
            )}
          </aside>

          <div className="space-y-4">
            {analyzing && !report ? (
              <ResultLoadingScene preview={selectedPreview} stepIndex={loadingStep} />
            ) : !report ? (
              <div className="stage-panel rounded-[1.35rem] p-4 text-white/56">
                <ToneBadge tone="slate">等待片单生成</ToneBadge>
                <p className="mt-4 text-sm leading-7">选中电影后，这里会直接给出判断。</p>
              </div>
            ) : (
              <>
                <section className="stage-panel rounded-[1.35rem] p-4 xl:sticky xl:top-4 xl:z-10">
                  <div className="flex flex-wrap gap-2">
                    {analyzing ? <ToneBadge tone="gold">持续更新中</ToneBadge> : null}
                    {analyzing && analysisProgress ? (
                      <span className={joinClasses("rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase", stateToneClasses["分析中"])}>
                        已完成 {analysisProgress.completed}/{analysisProgress.total}
                      </span>
                    ) : null}
                    {getReportStateBadges(report).map((badge) => (
                      <span
                        key={badge}
                        className={joinClasses(
                          "rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase",
                          stateToneClasses[badge],
                        )}
                      >
                        {badge}
                      </span>
                    ))}
                    <ToneBadge tone={reportSummary?.tone ?? "slate"}>{reportSummary?.eyebrow ?? "本次结论"}</ToneBadge>
                  </div>
                  <div className="mt-3 h-px bg-gradient-to-r from-white/10 via-white/4 to-transparent" />
                  <h3 className="mt-3 font-display text-[1.9rem] leading-[1.02] tracking-[-0.015em] text-white lg:text-[2.05rem]">{reportSummary?.headline}</h3>
                </section>

                <section className="stage-panel rounded-[1.35rem] p-4">
                  <h4 className="text-sm uppercase tracking-[0.24em] text-white/42">版本依据</h4>
                  <div className="mt-3 h-px bg-gradient-to-r from-white/10 via-white/4 to-transparent" />
                  <div className="mt-3 rounded-[1.1rem] border border-[#d8b56a]/18 bg-[#d8b56a]/8 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <ToneBadge tone="gold">当前基准</ToneBadge>
                      <p className="min-w-0 text-sm text-white/46">{report.preferredVersion.source}</p>
                    </div>
                    <div className="mt-2">
                      <p className="text-[1.7rem] font-semibold leading-tight text-white">{report.preferredVersion.label}</p>
                    </div>
                    <p className="mt-2 text-sm text-white/72">时长 {formatDuration(report.preferredVersion.durationSeconds)}</p>
                    <p className="mt-2.5 text-sm leading-6 text-[#f1ddb1]">
                      {getPreferredVersionReason(report.preferredVersion, report.alternateVersions)}
                    </p>
                    {report.preferredVersion.notes ? <p className="mt-2.5 text-sm leading-6 text-white/56">{report.preferredVersion.notes}</p> : null}
                  </div>
                  {dedupedAlternateVersions.length > 0 ? (
                    <div className="mt-3 space-y-2.5">
                      {dedupedAlternateVersions.map((version) => (
                        <div key={version.id} className="rounded-[1rem] border border-white/10 bg-white/[0.03] px-3.5 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{version.label}</p>
                              <p className="mt-1 truncate text-sm text-white/46">{version.source}</p>
                            </div>
                            <span className="shrink-0 text-sm text-white/72">{formatDuration(version.durationSeconds)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {report.caution ? <p className="mt-3 text-sm leading-6 text-white/56">{report.caution}</p> : null}
                </section>

                <section className="stage-panel rounded-[1.35rem] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm uppercase tracking-[0.24em] text-white/42">平台判断</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {platformFilterOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setPlatformFilterMode(option.id)}
                          className={joinClasses(
                            "rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase",
                            platformFilterMode === option.id
                              ? "border-[#d8b56a]/35 bg-[#d8b56a]/12 text-[#f7e7b7]"
                              : "border-white/10 bg-white/[0.03] text-white/52 hover:border-white/16 hover:text-white/72",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                      {platformSortOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setPlatformSortMode(option.id)}
                          className={joinClasses(
                            "rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase",
                            platformSortMode === option.id
                              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                              : "border-white/10 bg-white/[0.03] text-white/52 hover:border-white/16 hover:text-white/72",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 h-px bg-gradient-to-r from-white/10 via-white/4 to-transparent" />

                  {visiblePlatforms.length === 0 ? (
                    <div className="mt-3 rounded-[1.1rem] border border-dashed border-white/12 px-4 py-5 text-sm leading-6 text-white/58">
                      {platformFilterMode === "all" ? "当前没有识别到国内播放源，这会作为正式结果保留。" : "当前筛选条件下没有可展示的平台。"}
                    </div>
                  ) : (
                    <div className="mt-3 overflow-hidden rounded-[1.1rem] border border-white/10 bg-white/[0.025]">
                      <div className="hidden grid-cols-[minmax(0,1.35fr)_0.85fr_0.9fr_auto] gap-4 border-b border-white/8 px-4 py-3 text-[11px] uppercase tracking-[0.22em] text-white/34 md:grid">
                        <span>平台</span>
                        <span>片长</span>
                        <span>判断</span>
                        <span className="text-right">操作</span>
                      </div>
                      {visiblePlatforms.map((platform) => {
                        const state = getPlatformState(platform);
                        const durationText = platform.durationSeconds ? formatDuration(platform.durationSeconds) : "待确认";

                        return (
                          <article
                            key={platform.id}
                            className="grid gap-3 border-b border-white/8 px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1.35fr)_0.85fr_0.9fr_auto] md:items-center"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="text-base font-semibold text-white">{platform.platform}</h5>
                                <span className={joinClasses("rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]", stateToneClasses[analyzing && !platform.durationSeconds ? "分析中" : state])}>
                                  {analyzing && !platform.durationSeconds ? "分析中" : state}
                                </span>
                                <span className="md:hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-white/45">
                                  {durationText}
                                </span>
                              </div>
                              <p className="mt-1 text-sm leading-6 text-white/62">{getPlatformQuickReason(platform)}</p>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-white/72 md:block md:text-base">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-white/34 md:hidden">片长</span>
                              <span>{durationText}</span>
                            </div>
                            <div className="flex items-center gap-2 md:block">
                              <span className="text-[10px] uppercase tracking-[0.18em] text-white/34 md:hidden">判断</span>
                              <span className={joinClasses("rounded-full border px-3 py-1 text-[11px] font-medium tracking-[0.12em] uppercase", verdictToneClasses[platform.verdict])}>
                                {platform.verdict}
                              </span>
                            </div>
                            <div className="flex justify-end">
                              <a href={platform.url} target="_blank" rel="noreferrer" className="text-sm text-[#f0d79f] hover:text-[#f5e4bb]">
                                {getPlatformActionLabel(platform)}
                              </a>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}







