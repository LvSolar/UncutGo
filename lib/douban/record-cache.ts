import { readCache, writeCache } from "../cache/file-cache";
import type { MovieRecord } from "../../types/movie";
import { fetchDoubanSubjectHtml } from "./client";
import { parseDoubanMovieRecord } from "./parser";

const DOUBAN_RECORD_CACHE_VERSION = "v2";
const EMPTY_SUMMARY = "豆瓣简介暂未解析到。";

function isUsableMovieRecord(record: MovieRecord): boolean {
  const hasMeaningfulTitle = record.title.trim().length > 0;
  const hasEnoughMetadata =
    record.year > 0 ||
    record.director !== "待确认" ||
    record.doubanRating > 0 ||
    record.summary !== EMPTY_SUMMARY ||
    record.versions.some((version) => version.durationSeconds > 0);

  return hasMeaningfulTitle && hasEnoughMetadata;
}

export async function getDoubanMovieRecord(subjectId: string): Promise<MovieRecord> {
  const cacheKey = `${DOUBAN_RECORD_CACHE_VERSION}-douban-record-${subjectId}`;
  const cached = await readCache<MovieRecord>(cacheKey);

  if (cached && isUsableMovieRecord(cached)) {
    return cached;
  }

  let html = await fetchDoubanSubjectHtml(subjectId);
  let record = parseDoubanMovieRecord(subjectId, html);

  if (!isUsableMovieRecord(record)) {
    html = await fetchDoubanSubjectHtml(subjectId, { forceCookieRefresh: true });
    record = parseDoubanMovieRecord(subjectId, html);
  }

  if (!isUsableMovieRecord(record)) {
    throw new Error("豆瓣详情页解析不完整，请稍后重新抓取。");
  }

  await writeCache(cacheKey, record);

  return record;
}
