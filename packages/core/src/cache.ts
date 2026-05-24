import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hash: string;
}

export class ContentCache {
  private dir: string;

  constructor(stateDir: string) {
    this.dir = resolve(stateDir, "cache");
    try { mkdirSync(this.dir, { recursive: true }); } catch {}
  }

  get<T>(key: string, maxAgeMs: number): { data: T; isNew: boolean } | null {
    try {
      const raw = readFileSync(resolve(this.dir, `${key}.json`), "utf-8");
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (Date.now() - entry.timestamp < maxAgeMs) {
        return { data: entry.data, isNew: false };
      }
    } catch {}
    return null;
  }

  set<T>(key: string, data: T): boolean {
    const hash = JSON.stringify(data);
    let isNew = true;
    try {
      const raw = readFileSync(resolve(this.dir, `${key}.json`), "utf-8");
      const prev = JSON.parse(raw) as CacheEntry<T>;
      isNew = prev.hash !== hash;
    } catch {}

    const entry: CacheEntry<T> = { data, timestamp: Date.now(), hash };
    writeFileSync(resolve(this.dir, `${key}.json`), JSON.stringify(entry), "utf-8");
    return isNew;
  }
}
