import { NextResponse } from "next/server";

import { readCache, writeCache } from "../../../../lib/cache/file-cache";
import { getDoubanMovieRecord } from "../../../../lib/douban/record-cache";
import { analyzeMovie } from "../../../../lib/judgement";
import { findMovieById } from "../../../../lib/mock-data";
import { fetchLibvioOffer, fetchPlatformDuration } from "../../../../lib/platforms";
import type { AnalysisReport, MovieRecord, PlatformOffer } from "../../../../types/movie";

const ANALYSIS_CACHE_VERSION = "v17";

type StreamMessage = {
  type: "progress" | "complete";
  report: AnalysisReport;
  completed: number;
  total: number;
};

function jsonLine(message: StreamMessage): string {
  return `${JSON.stringify(message)}\n`;
}

function appendPlatformNote(platform: PlatformOffer, note: string): string {
  return [platform.notes, note].filter(Boolean).join(" ");
}

function createLibvioPlaceholder(): PlatformOffer {
  return {
    id: "libvio-search",
    platform: "Libvio",
    available: false,
    url: "https://www.libvio.app/",
    notes: "分析中。",
  };
}

function buildLiveReport(movie: MovieRecord): AnalysisReport {
  return {
    ...analyzeMovie(movie),
    status: "live",
  };
}

async function resolvePlatform(platform: PlatformOffer): Promise<PlatformOffer> {
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
        error instanceof Error ? `Platform fetch failed: ${error.message}` : "Platform fetch failed.",
      ),
    };
  }
}

async function resolveLibvio(movie: MovieRecord): Promise<PlatformOffer> {
  try {
    return await fetchLibvioOffer(movie);
  } catch (error) {
    return {
      id: "libvio-search",
      platform: "Libvio",
      available: false,
      url: "https://www.libvio.app/",
      notes: error instanceof Error ? `Libvio fetch failed: ${error.message}` : "Libvio fetch failed.",
    };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const movieId = searchParams.get("movieId");
  const force = searchParams.get("force") === "1";

  if (!movieId) {
    return NextResponse.json({ error: "missing movieId" }, { status: 400 });
  }

  const cacheKey = `${ANALYSIS_CACHE_VERSION}-analysis-${movieId}`;
  const cached = force ? null : await readCache<AnalysisReport>(cacheKey);

  if (cached) {
    const payload = jsonLine({
      type: "complete",
      report: {
        ...cached,
        cache: "hit",
      },
      completed: cached.platforms.length,
      total: cached.platforms.length,
    });

    return new Response(payload, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  if (!movieId.startsWith("douban:")) {
    const movie = findMovieById(movieId);

    if (!movie) {
      return NextResponse.json({ error: "movie not found" }, { status: 404 });
    }

    const report = analyzeMovie(movie);
    await writeCache(cacheKey, report);

    return new Response(
      jsonLine({
        type: "complete",
        report: {
          ...report,
          cache: "miss",
        },
        completed: report.platforms.length,
        total: report.platforms.length,
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  const subjectId = movieId.replace("douban:", "");
  const parsedMovie = await getDoubanMovieRecord(subjectId);
  const baseMovie: MovieRecord = {
    ...parsedMovie,
    platforms: [...parsedMovie.platforms, createLibvioPlaceholder()],
  };

  const total = baseMovie.platforms.length;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let currentPlatforms = [...baseMovie.platforms];
      let completed = 0;

      controller.enqueue(
        encoder.encode(
          jsonLine({
            type: "progress",
            report: buildLiveReport({ ...baseMovie, platforms: currentPlatforms }),
            completed,
            total,
          }),
        ),
      );

      const tasks = new Map<
        string,
        Promise<{ id: string; platform: PlatformOffer }>
      >();

      for (const platform of parsedMovie.platforms) {
        tasks.set(
          platform.id,
          resolvePlatform(platform).then((resolved) => ({
            id: platform.id,
            platform: resolved,
          })),
        );
      }

      tasks.set(
        "libvio-search",
        resolveLibvio(parsedMovie).then((resolved) => ({
          id: "libvio-search",
          platform: resolved,
        })),
      );

      while (tasks.size > 0) {
        const { id, platform } = await Promise.race(tasks.values());
        tasks.delete(id);
        completed += 1;

        currentPlatforms = currentPlatforms.map((item) => (item.id === id ? platform : item));
        const report = buildLiveReport({ ...baseMovie, platforms: currentPlatforms });

        controller.enqueue(
          encoder.encode(
            jsonLine({
              type: tasks.size === 0 ? "complete" : "progress",
              report,
              completed,
              total,
            }),
          ),
        );

        if (tasks.size === 0) {
          await writeCache(cacheKey, report);
        }
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}







