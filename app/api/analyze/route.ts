import { NextResponse } from "next/server";

import { readCache, writeCache } from "../../../lib/cache/file-cache";
import { getDoubanMovieRecord } from "../../../lib/douban/record-cache";
import { analyzeMovie } from "../../../lib/judgement";
import { findMovieById } from "../../../lib/mock-data";
import { fetchLibvioOffer, fetchPlatformDuration } from "../../../lib/platforms";
import type { AnalysisReport, MovieRecord, PlatformOffer } from "../../../types/movie";

interface AnalyzePayload {
  movieId?: string;
  force?: boolean;
}

const ANALYSIS_CACHE_VERSION = "v17";

function appendPlatformNote(platform: PlatformOffer, note: string): string {
  return [platform.notes, note].filter(Boolean).join(" ");
}

async function enrichMovieWithPlatformDurations(movie: MovieRecord): Promise<MovieRecord> {
  const platformDurationsPromise = Promise.all(
    movie.platforms.map(async (platform) => {
      try {
        const runtime = await fetchPlatformDuration(platform.url);

        if (Object.keys(runtime).length === 0) {
          return platform;
        }

        return {
          ...platform,
          ...runtime,
        };
      } catch (error) {
        return {
          ...platform,
          notes: appendPlatformNote(
            platform,
            error instanceof Error
              ? `Platform fetch failed: ${error.message}`
              : "Platform fetch failed.",
          ),
        };
      }
    }),
  );

  const libvioOfferPromise = fetchLibvioOffer(movie).catch((error) => ({
    id: "libvio-search",
    platform: "Libvio",
    available: false,
    url: "https://www.libvio.app/",
    notes:
      error instanceof Error
        ? `Libvio fetch failed: ${error.message}`
        : "Libvio fetch failed.",
  }) satisfies PlatformOffer);

  const [platforms, libvioOffer] = await Promise.all([platformDurationsPromise, libvioOfferPromise]);

  return {
    ...movie,
    platforms: [...platforms, libvioOffer],
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzePayload;

  if (!body.movieId) {
    return NextResponse.json({ error: "missing movieId" }, { status: 400 });
  }

  const cacheKey = `${ANALYSIS_CACHE_VERSION}-analysis-${body.movieId}`;
  const cached = body.force ? null : await readCache<AnalysisReport>(cacheKey);

  if (cached) {
    return NextResponse.json({
      ...cached,
      cache: "hit",
    });
  }

  if (body.movieId.startsWith("douban:")) {
    const subjectId = body.movieId.replace("douban:", "");
    const parsedMovie = await getDoubanMovieRecord(subjectId);
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
    return NextResponse.json({ error: "movie not found" }, { status: 404 });
  }

  const report = analyzeMovie(movie);
  await writeCache(cacheKey, report);

  return NextResponse.json({
    ...report,
    cache: "miss",
  });
}






