import { promises as fs } from "node:fs";
import path from "node:path";

const cacheRoot = path.join(process.cwd(), "data", "cache");

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const filePath = path.join(cacheRoot, `${key}.json`);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    const filePath = path.join(cacheRoot, `${key}.json`);
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // In serverless environments like Vercel, local filesystem writes may fail.
    // The analysis result should still be returned even when the cache cannot persist.
  }
}
