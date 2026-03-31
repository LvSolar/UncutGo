import { NextResponse } from "next/server";

import { readCache, writeCache } from "../../../lib/cache/file-cache";
import { fetchDoubanSubjectHtml } from "../../../lib/douban/client";
import { parseDoubanMovieRecord } from "../../../lib/douban/parser";
import { analyzeMovie } from "../../../lib/judgement";
import { findMovieById } from "../../../lib/mock-data";
import { fetchBilibiliDuration } from "../../../lib/platforms/bilibili";
import { fetchTencentDuration } from "../../../lib/platforms/tencent";
import type { AnalysisReport, MovieRecord } from "../../../types/movie";

interface AnalyzePayload {
  movieId?: string;
}

const ANALYSIS_CACHE_VERSION = "v3";

async function enrichMovieWithPlatformDurations(movie: MovieRecord): Promise<MovieRecord> {
  const platforms = await Promise.all(
    movie.platforms.map(async (platform) => {
      if (platform.url.includes("v.qq.com")) {
        const runtime = await fetchTencentDuration(platform.url);
        return {
          ...platform,
          ...runtime,
        };
      }

      if (platform.url.includes("bilibili.com")) {
        const runtime = await fetchBilibiliDuration(platform.url);
        return {
          ...platform,
          ...runtime,
        };
      }

      return platform;
    }),
  );

  return {
    ...movie,
    platforms,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzePayload;

  if (!body.movieId) {
    return NextResponse.json({ error: "缺少 movieId" }, { status: 400 });
  }

  const cacheKey = `${ANALYSIS_CACHE_VERSION}-analysis-${body.movieId}`;
  const cached = await readCache<AnalysisReport>(cacheKey);

  if (cached) {
    return NextResponse.json({
      ...cached,
      cache: "hit",
    });
  }

  if (body.movieId.startsWith("douban:")) {
    const subjectId = body.movieId.replace("douban:", "");
    const html = await fetchDoubanSubjectHtml(subjectId);
    const parsedMovie = parseDoubanMovieRecord(subjectId, html);
    const movie = await enrichMovieWithPlatformDurations(parsedMovie);
    const report = {
      ...analyzeMovie(movie),
      status: "live" as const,
    };

    await writeCache(cacheKey, report);

    return NextResponse.json({
      ...report,
      cache: "miss",
    });
  }

  const movie = findMovieById(body.movieId);

  if (!movie) {
    return NextResponse.json({ error: "找不到这部电影" }, { status: 404 });
  }

  const report = analyzeMovie(movie);
  await writeCache(cacheKey, report);

  return NextResponse.json({
    ...report,
    cache: "miss",
  });
}
