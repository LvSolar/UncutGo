"use client";

import { startTransition, useState } from "react";

import { formatDuration } from "../lib/utils/time";
import type { AnalysisReport, CandidateMovie, JudgedPlatformOffer } from "../types/movie";

const verdictToneClasses: Record<string, string> = {
  大概率无删减: "border-accent/30 bg-accent/10 text-accent-strong",
  可能无删减: "border-warm/30 bg-warm/10 text-[#8a5a16]",
  版本不一致: "border-[#446a91]/30 bg-[#446a91]/10 text-[#27496c]",
  可能删减: "border-[#b06b20]/30 bg-[#b06b20]/10 text-[#7d470d]",
  疑似删减: "border-danger/30 bg-danger/10 text-danger",
  信息不足: "border-black/10 bg-black/5 text-foreground/70",
};

const stateToneClasses: Record<string, string> = {
  实时结果: "border-accent/20 bg-accent/10 text-accent-strong",
  缓存结果: "border-line bg-white/80 text-foreground/70",
  样例数据: "border-[#b06b20]/20 bg-[#b06b20]/10 text-[#7d470d]",
  浏览器兜底: "border-[#446a91]/20 bg-[#446a91]/10 text-[#27496c]",
  已获取片长: "border-accent/20 bg-accent/10 text-accent-strong",
  真实媒体时长: "border-accent/20 bg-accent/10 text-accent-strong",
  站内已匹配: "border-[#446a91]/20 bg-[#446a91]/10 text-[#27496c]",
  未搜到片源: "border-black/10 bg-black/5 text-foreground/70",
  无播放入口: "border-black/10 bg-black/5 text-foreground/70",
  时长待确认: "border-[#b06b20]/20 bg-[#b06b20]/10 text-[#7d470d]",
  豆瓣实时搜索: "border-accent/20 bg-accent/10 text-accent-strong",
  样例候选: "border-[#b06b20]/20 bg-[#b06b20]/10 text-[#7d470d]",
};

type SearchResponse = {
  candidates: CandidateMovie[];
  mode?: "idle" | "live" | "mock-fallback";
  warning?: string;
};

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

function getReportMessage(report: AnalysisReport): string {
  if (report.status !== "live") {
    return "当前展示的是样例数据，页面结构和判定逻辑可正常预览。";
  }

  if (report.cache === "hit") {
    return "这次展示的是缓存结果，适合快速复看；重新抓取到新版本后会自动更新。";
  }

  return "这次展示的是实时抓取结果，已按当前可拿到的豆瓣信息和平台片长完成判断。";
}

function getPlatformState(platform: JudgedPlatformOffer): string {
  const notes = platform.notes ?? "";

  if (notes.includes("浏览器级渲染")) {
    return "浏览器兜底";
  }

  if (platform.durationSeconds) {
    if (notes.includes("m3u8") || notes.includes("真实媒体地址")) {
      return "真实媒体时长";
    }

    return "已获取片长";
  }

  if (!platform.available && notes.includes("暂未找到匹配电影")) {
    return "未搜到片源";
  }

  if (platform.available && notes.includes("暂未识别到可播放入口")) {
    return "无播放入口";
  }

  if (platform.available || notes.includes("已定位到播放页") || notes.includes("已搜索到匹配电影")) {
    return "时长待确认";
  }

  return "站内已匹配";
}

function getPlatformStatusText(platform: JudgedPlatformOffer): string {
  const state = getPlatformState(platform);

  switch (state) {
    case "浏览器兜底":
      return "已通过浏览器兜底拿到可信片长";
    case "真实媒体时长":
      return "已拿到真实媒体时长";
    case "已获取片长":
      return "已拿到可信片长";
    case "未搜到片源":
      return "站内暂未搜到这部电影";
    case "无播放入口":
      return "已找到条目，但暂未识别到可播放入口";
    case "时长待确认":
      return "已找到条目或播放页，正在等待更稳定的时长解析";
    default:
      return "已匹配到站内条目";
  }
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<CandidateMovie[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [searchMode, setSearchMode] = useState<"live" | "mock-fallback" | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "当前原型已经接通真实豆瓣搜索和详情解析，并支持腾讯视频、哔哩哔哩、爱奇艺、优酷和 Libvio 的片长分析。",
  );

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setSearching(true);
    setReport(null);
    setSelectedId(null);
    setSearchMode(null);
    setSearchWarning(null);
    setMessage("正在查找候选电影……");

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = (await response.json()) as SearchResponse;
      setCandidates(data.candidates);
      setSearchMode(data.mode === "mock-fallback" ? "mock-fallback" : data.mode === "live" ? "live" : null);
      setSearchWarning(data.warning ?? null);

      if (data.mode === "mock-fallback" && data.candidates.length === 0) {
        setMessage("豆瓣实时搜索刚刚没有成功，当前样例候选里也没有这部电影。你可以稍后再试，不一定是关键词有问题。");
      } else if (data.mode === "mock-fallback") {
        setMessage("豆瓣实时搜索刚刚没有成功，当前先回退到样例候选结果。你仍然可以继续体验分析流程。");
      } else if (data.candidates.length === 0) {
        setMessage("豆瓣实时搜索已执行，但当前没有找到匹配候选。你可以换个关键词，或试试别名、原名。");
      } else {
        setMessage("已拿到豆瓣真实候选结果，选一部继续分析吧。");
      }
    } catch {
      setCandidates([]);
      setSearchMode(null);
      setSearchWarning(null);
      setMessage("搜索失败了，稍后再试。");
    } finally {
      setSearching(false);
    }
  }

  async function handleAnalyze(movieId: string) {
    setSelectedId(movieId);
    setAnalyzing(true);
    setMessage("正在抓取豆瓣详情、版本信息和平台片长……");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ movieId }),
      });

      const data = (await response.json()) as AnalysisReport;

      startTransition(() => {
        setReport(data);
      });

      if (data.status === "live") {
        setMessage(
          data.cache === "hit"
            ? "分析已完成，当前展示的是缓存结果。"
            : "分析已完成，当前展示的是本次实时抓取结果。",
        );
      } else {
        setMessage("分析已完成，当前展示的是样例数据。");
      }
    } catch {
      setMessage("分析失败了，稍后再试。");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[2rem] border border-line bg-panel shadow-[0_24px_80px_rgba(59,45,24,0.12)] backdrop-blur">
        <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-10">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-white/55 px-3 py-1 text-sm text-accent-strong">
              <span className="h-2 w-2 rounded-full bg-accent" />
              UncutGo
            </div>
            <div className="space-y-4">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                输入电影名，直接看国内哪里更可能是无删减版。
              </h1>
              <p className="max-w-2xl text-base leading-8 text-muted sm:text-lg">
                当前优先把结果做准：先以豆瓣版本为参考，再结合腾讯视频、哔哩哔哩、爱奇艺、优酷和 Libvio 的真实片长来判断。
              </p>
            </div>
            <form className="space-y-3" onSubmit={handleSearch}>
              <label className="block text-sm font-medium text-foreground/80" htmlFor="movie-query">
                电影名或豆瓣链接
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="movie-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例如：教父 / 杀手没有假期 / 豆瓣链接"
                  className="min-h-14 flex-1 rounded-2xl border border-line bg-white/80 px-4 text-base outline-none ring-0 placeholder:text-muted/75 focus:border-accent focus:bg-white"
                />
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="min-h-14 rounded-2xl bg-accent px-6 text-base font-medium text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {searching ? "搜索中..." : "开始查询"}
                </button>
              </div>
            </form>
            {(searchMode || searchWarning) && !report ? (
              <div className="flex flex-wrap gap-2 text-xs">
                {searchMode ? (
                  <span
                    className={`rounded-full border px-3 py-1 font-medium ${
                      stateToneClasses[searchMode === "live" ? "豆瓣实时搜索" : "样例候选"]
                    }`}
                  >
                    {searchMode === "live" ? "豆瓣实时搜索" : "样例候选"}
                  </span>
                ) : null}
                {searchWarning ? (
                  <span className="rounded-full border border-[#b06b20]/20 bg-[#b06b20]/10 px-3 py-1 font-medium text-[#7d470d]">
                    {searchWarning}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="rounded-2xl border border-line bg-white/65 px-4 py-3 text-sm leading-7 text-muted">
              {message}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-line bg-panel-strong p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
            <p className="text-sm uppercase tracking-[0.28em] text-muted">当前能力</p>
            <div className="mt-4 space-y-3 text-sm leading-7 text-foreground/80">
              <p>1. 真实豆瓣搜索候选与详情解析。</p>
              <p>2. 多版本时长展示，并按优先级自动选参考版本。</p>
              <p>3. 腾讯视频、哔哩哔哩、爱奇艺、优酷和 Libvio 片长分析。</p>
              <p>4. 页面会区分实时结果、缓存结果、信息不足和无播放源。</p>
            </div>
            <div className="mt-6 rounded-2xl bg-[#efe2cb] px-4 py-4 text-sm leading-7 text-[#6c5636]">
              有些电影在国内没有播放源，这会作为正式结果展示，而不是当作异常报错处理。
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[1.75rem] border border-line bg-panel p-5 shadow-[0_14px_50px_rgba(59,45,24,0.08)] backdrop-blur">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">候选电影</h2>
              <p className="text-sm text-muted">先选对电影，再做版本和平台判断。</p>
            </div>
            <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
              {candidates.length} 部
            </span>
          </div>

          <div className="space-y-3">
            {candidates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm leading-7 text-muted">
                先搜一部电影试试看。当前搜索会优先走豆瓣真实接口；如果豆瓣临时不可用，页面也会明确提示你。
              </div>
            ) : (
              candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => void handleAnalyze(candidate.id)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left ${
                    selectedId === candidate.id
                      ? "border-accent bg-accent/8"
                      : "border-line bg-white/70 hover:border-accent/40 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {candidate.title} ({candidate.year || "年份待确认"})
                      </h3>
                      <p className="text-sm text-muted">{candidate.originalTitle}</p>
                    </div>
                    {typeof candidate.doubanRating === "number" ? (
                      <span className="rounded-full bg-[#efe2cb] px-3 py-1 text-xs font-medium text-[#7c5c2e]">
                        豆瓣 {candidate.doubanRating}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-foreground/75">导演：{candidate.director}</p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-line bg-panel p-5 shadow-[0_14px_50px_rgba(59,45,24,0.08)] backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-foreground">分析结果</h2>
              <p className="text-sm text-muted">这里会展示版本基准、平台差值和判定理由。</p>
            </div>
            {analyzing ? (
              <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent-strong">
                分析中...
              </span>
            ) : null}
          </div>

          {!report ? (
            <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-sm leading-7 text-muted">
              选择左侧候选电影后，这里会生成一份“参考版本 + 平台判断”报告。
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-[1.5rem] bg-panel-strong p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-semibold text-foreground">
                      {report.movie.title} ({report.movie.year})
                    </h3>
                    <p className="mt-1 text-sm text-muted">{report.movie.originalTitle}</p>
                  </div>
                  <div className="rounded-2xl bg-[#efe2cb] px-4 py-2 text-sm font-medium text-[#7c5c2e]">
                    豆瓣评分 {report.movie.doubanRating}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {getReportStateBadges(report).map((badge) => (
                    <span
                      key={badge}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${stateToneClasses[badge]}`}
                    >
                      {badge}
                    </span>
                  ))}
                  <span className="rounded-full border border-line bg-white/80 px-3 py-1 text-xs text-foreground/70">
                    更新于 {formatGeneratedAt(report.generatedAt)}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 text-sm text-foreground/80 sm:grid-cols-2">
                  <p>导演：{report.movie.director}</p>
                  <a
                    href={report.movie.doubanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-strong underline decoration-accent/30 underline-offset-4"
                  >
                    打开豆瓣页面
                  </a>
                </div>
                <p className="mt-4 text-sm leading-7 text-muted">{report.movie.summary}</p>
                <p className="mt-4 rounded-2xl border border-line bg-white/75 px-4 py-3 text-sm leading-7 text-foreground/75">
                  {getReportMessage(report)}
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-[1.5rem] border border-line bg-white/70 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold text-foreground">参考版本</h4>
                    <span className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent-strong">
                      当前基准
                    </span>
                  </div>
                  <div className="mt-4 rounded-2xl bg-accent/8 p-4">
                    <p className="text-sm text-muted">{report.preferredVersion.source}</p>
                    <p className="mt-2 text-lg font-semibold text-foreground">
                      {report.preferredVersion.label}
                    </p>
                    <p className="mt-1 text-sm text-foreground/75">
                      时长 {formatDuration(report.preferredVersion.durationSeconds)}
                    </p>
                    {report.preferredVersion.notes ? (
                      <p className="mt-3 text-sm leading-7 text-muted">
                        {report.preferredVersion.notes}
                      </p>
                    ) : null}
                  </div>
                  {report.caution ? (
                    <p className="mt-4 rounded-2xl bg-[#efe2cb] px-4 py-3 text-sm leading-7 text-[#6c5636]">
                      {report.caution}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-[1.5rem] border border-line bg-white/70 p-4">
                  <h4 className="text-base font-semibold text-foreground">已识别版本</h4>
                  <div className="mt-4 space-y-3">
                    {[report.preferredVersion, ...report.alternateVersions].map((version) => (
                      <div
                        key={version.id}
                        className="rounded-2xl border border-line bg-white/80 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-foreground">{version.label}</p>
                            <p className="text-sm text-muted">{version.source}</p>
                          </div>
                          <span className="text-sm font-medium text-foreground/75">
                            {formatDuration(version.durationSeconds)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-base font-semibold text-foreground">平台判断</h4>
                {report.platforms.length === 0 ? (
                  <div className="rounded-[1.5rem] border border-dashed border-line bg-white/70 px-4 py-8 text-sm leading-7 text-muted">
                    当前没有识别到国内播放源。这种情况会被视为正式结果，而不是抓取失败。
                  </div>
                ) : (
                  report.platforms.map((platform) => {
                    const state = getPlatformState(platform);

                    return (
                      <div
                        key={platform.id}
                        className="rounded-[1.5rem] border border-line bg-white/75 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h5 className="text-lg font-semibold text-foreground">{platform.platform}</h5>
                            <p className="mt-1 text-sm text-muted">
                              {platform.available && platform.durationSeconds
                                ? `片长 ${formatDuration(platform.durationSeconds)}`
                                : getPlatformStatusText(platform)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                stateToneClasses[state]
                              }`}
                            >
                              {state}
                            </span>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                                verdictToneClasses[platform.verdict]
                              }`}
                            >
                              {platform.verdict}
                            </span>
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-7 text-foreground/80">{platform.reason}</p>
                        {platform.notes ? (
                          <p className="mt-2 text-sm leading-7 text-muted">{platform.notes}</p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
                          <span className="text-muted">
                            {typeof platform.deltaSeconds === "number"
                              ? `与参考版本差 ${platform.deltaSeconds} 秒`
                              : "差值待真实抓取后更新"}
                          </span>
                          <a
                            href={platform.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-strong underline decoration-accent/30 underline-offset-4"
                          >
                            打开平台页面
                          </a>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

