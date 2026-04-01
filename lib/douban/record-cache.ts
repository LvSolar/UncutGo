import { readCache, writeCache } from "../cache/file-cache";
import type { MovieRecord } from "../../types/movie";
import { fetchDoubanSubjectHtml } from "./client";
import { parseDoubanMovieRecord } from "./parser";

const DOUBAN_RECORD_CACHE_VERSION = "v1";

export async function getDoubanMovieRecord(subjectId: string): Promise<MovieRecord> {
  const cacheKey = `${DOUBAN_RECORD_CACHE_VERSION}-douban-record-${subjectId}`;
  const cached = await readCache<MovieRecord>(cacheKey);

  if (cached) {
    return cached;
  }

  const html = await fetchDoubanSubjectHtml(subjectId);
  const record = parseDoubanMovieRecord(subjectId, html);

  await writeCache(cacheKey, record);

  return record;
}
