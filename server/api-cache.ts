import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.join(process.cwd(), "server", ".api-cache");
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const cachePath = path.join(CACHE_DIR, `${key}.json`);
    
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const content = fs.readFileSync(cachePath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(content);

    // Check if cache is still valid (within 24 hours)
    const age = Date.now() - entry.timestamp;
    if (age < CACHE_DURATION_MS) {
      console.log(`Cache HIT for ${key} (age: ${Math.round(age / 1000 / 60)} minutes)`);
      return entry.data;
    }

    console.log(`Cache EXPIRED for ${key}`);
    return null;
  } catch (error) {
    console.error(`Cache read error for ${key}:`, error);
    return null;
  }
}

export async function setCache<T>(key: string, data: T): Promise<void> {
  try {
    const cachePath = path.join(CACHE_DIR, `${key}.json`);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };

    fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2));
    console.log(`Cache SAVED for ${key}`);
  } catch (error) {
    console.error(`Cache write error for ${key}:`, error);
  }
}

export async function getStaleCache<T>(key: string): Promise<T | null> {
  try {
    const cachePath = path.join(CACHE_DIR, `${key}.json`);
    
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const content = fs.readFileSync(cachePath, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(content);

    console.log(`Using STALE cache for ${key} (last updated: ${new Date(entry.timestamp).toLocaleString()})`);
    return entry.data;
  } catch (error) {
    console.error(`Stale cache read error for ${key}:`, error);
    return null;
  }
}

export function clearCache(): void {
  try {
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
      }
      console.log(`Cleared ${files.length} cache files`);
    }
  } catch (error) {
    console.error("Cache clear error:", error);
  }
}
