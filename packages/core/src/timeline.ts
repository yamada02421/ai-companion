import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from "fs";
import { logError } from "./logger.js";

export type TimelineEventType =
  | "chat"        // 会話
  | "proactive"   // プロアクティブ発言
  | "curate"      // ニュースキュレーション
  | "observe"     // 画面認識
  | "milestone"   // マイルストーン達成
  | "system";     // システムイベント

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;   // ISO
  summary: string;     // 1行要約
  details?: string;    // 詳細（オプション）
}

/** Maximum number of events to keep */
const MAX_EVENTS = 500;

/** Generate a unique event ID */
function generateId(): string {
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${now}-${rand}`;
}

export class TimelineManager {
  private filePath: string;
  private events: TimelineEvent[];

  constructor(stateDir: string, charName: string) {
    this.filePath = `${stateDir}/${charName}-timeline.json`;
    this.events = [];
    this.load();
  }

  // ---------- Persistence ----------

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.events = parsed;
      } else {
        throw new Error("Invalid timeline data: not an array");
      }
    } catch (e) {
      if (existsSync(this.filePath)) {
        logError("timeline.load", e);
      }
      this.events = [];
    }
  }

  private save(): void {
    const dir = this.filePath.replace(/[\\/][^\\/]+$/, "");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // directory may already exist
    }
    const tmpPath = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmpPath, JSON.stringify(this.events, null, 2), "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (e) {
      logError("timeline.save", e);
      try {
        writeFileSync(
          this.filePath,
          JSON.stringify(this.events, null, 2),
          "utf-8",
        );
      } catch (e2) {
        logError("timeline.save.fallback", e2);
      }
    }
  }

  // ---------- Public API ----------

  /**
   * Add a new event to the timeline.
   */
  addEvent(type: TimelineEventType, summary: string, details?: string): void {
    const event: TimelineEvent = {
      id: generateId(),
      type,
      timestamp: new Date().toISOString(),
      summary,
      details,
    };

    this.events.push(event);

    // Trim oldest events if over the limit
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(this.events.length - MAX_EVENTS);
    }

    this.save();
  }

  /**
   * Get the most recent events, ordered newest-first.
   * @param limit Maximum number of events to return (default: all)
   */
  getEvents(limit?: number): TimelineEvent[] {
    const sorted = [...this.events].reverse();
    if (limit !== undefined && limit > 0) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }

  /**
   * Get all events for a specific date (YYYY-MM-DD), ordered newest-first.
   */
  getEventsByDate(date: string): TimelineEvent[] {
    return this.events
      .filter((e) => e.timestamp.startsWith(date))
      .reverse();
  }
}
