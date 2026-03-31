import { NextResponse } from "next/server";

import { searchDoubanSuggestions } from "../../../lib/douban/client";
import { parseSuggestionCandidates } from "../../../lib/douban/parser";
import { findMoviesByQuery } from "../../../lib/mock-data";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";

  if (!query) {
    return NextResponse.json({ candidates: [] });
  }

  try {
    const rawJson = await searchDoubanSuggestions(query);
    const candidates = parseSuggestionCandidates(rawJson);

    return NextResponse.json({
      candidates,
      mode: "live",
    });
  } catch {
    const candidates = findMoviesByQuery(query).map((movie) => ({
      id: movie.id,
      title: movie.title,
      originalTitle: movie.originalTitle,
      year: movie.year,
      director: movie.director,
      doubanRating: movie.doubanRating,
      doubanUrl: movie.doubanUrl,
    }));

    return NextResponse.json({
      candidates,
      mode: "mock-fallback",
    });
  }
}
