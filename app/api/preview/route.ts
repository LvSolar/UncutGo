import { NextResponse } from "next/server";

import { readCache, writeCache } from "../../../lib/cache/file-cache";
import { getDoubanMovieRecord } from "../../../lib/douban/record-cache";
import { findMovieById } from "../../../lib/mock-data";
import type { MoviePreview, MovieRecord } from "../../../types/movie";

const PREVIEW_CACHE_VERSION = "v2";

function toMoviePreview(movie: MovieRecord): MoviePreview {
  return {
    id: movie.id,
    title: movie.title,
    originalTitle: movie.originalTitle,
    year: movie.year,
    director: movie.director,
    doubanRating: movie.doubanRating,
    doubanUrl: movie.doubanUrl,
    summary: movie.summary,
    posterUrl: movie.posterUrl,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const movieId = searchParams.get("id")?.trim();

  if (!movieId) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const cacheKey = `${PREVIEW_CACHE_VERSION}-preview-${movieId}`;
  const cached = await readCache<MoviePreview>(cacheKey);

  if (cached) {
    return NextResponse.json(cached);
  }

  let movie: MovieRecord | undefined;

  if (movieId.startsWith("douban:")) {
    const subjectId = movieId.replace("douban:", "");
    movie = await getDoubanMovieRecord(subjectId);
  } else {
    movie = findMovieById(movieId);
  }

  if (!movie) {
    return NextResponse.json({ error: "找不到这部电影" }, { status: 404 });
  }

  const preview = toMoviePreview(movie);
  await writeCache(cacheKey, preview);

  return NextResponse.json(preview);
}




