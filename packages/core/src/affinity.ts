import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
} from "fs";
import { logError } from "./logger.js";
import { fetchWeather, getCurrentWeatherMood } from "./weather.js";
import type { WeatherMoodEffect } from "./weather.js";

export type Mood =
  | "neutral"
  | "happy"
  | "curious"
  | "tired"
  | "lonely"
  | "excited";

export interface AffinityState {
  level: number; // 0-100 好感度レベル
  totalInteractions: number; // 累計会話回数
  streak: number; // 連続日数
  lastInteraction: string; // 最終会話日時 ISO
  mood: Mood; // 現在の気分
  moodUpdatedAt: string;
  milestones: string[]; // 達成済みマイルストーン
}

/** Daily interaction cap for affinity gain */
const DAILY_INTERACTION_CAP = 10;

/** Affinity gain per interaction */
const INTERACTION_GAIN = 1;

/** Affinity gain for news check */
const NEWS_GAIN = 0.5;

/** Days of inactivity before decay starts */
const DECAY_THRESHOLD_DAYS = 3;

/** Affinity loss per day of inactivity (beyond threshold) */
const DECAY_PER_DAY = 2;

/** Streak bonus tiers */
const STREAK_BONUSES: Array<{ days: number; bonus: number }> = [
  { days: 30, bonus: 20 },
  { days: 7, bonus: 10 },
  { days: 3, bonus: 5 },
];

/** All possible milestones */
const LEVEL_MILESTONES: Array<{ key: string; threshold: number }> = [
  { key: "level_100", threshold: 100 },
  { key: "level_75", threshold: 75 },
  { key: "level_50", threshold: 50 },
  { key: "level_25", threshold: 25 },
  { key: "level_10", threshold: 10 },
];

const STREAK_MILESTONES: Array<{ key: string; threshold: number }> = [
  { key: "streak_30", threshold: 30 },
  { key: "streak_7", threshold: 7 },
];

/** Mood labels for display */
const MOOD_LABELS: Record<Mood, string> = {
  neutral: "落ち着いている",
  happy: "嬉しい",
  curious: "興味深い",
  tired: "少し疲れている",
  lonely: "寂しい",
  excited: "テンションが高い",
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toDateString(iso: string): string {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  const diff = Math.abs(da.getTime() - db.getTime());
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function createDefaultState(): AffinityState {
  return {
    level: 0,
    totalInteractions: 0,
    streak: 0,
    lastInteraction: "",
    mood: "neutral",
    moodUpdatedAt: "",
    milestones: [],
  };
}

export class AffinityManager {
  private filePath: string;
  private state: AffinityState;
  private pendingMilestones: string[] = [];
  /** Track how many interactions have been counted today */
  private todayInteractionCount: number = 0;
  private todayDate: string = "";
  /** Cached weather mood effect (refreshed externally) */
  private weatherEffect: WeatherMoodEffect | null = null;
  private weatherApiKey: string | undefined;
  private weatherCity: string;
  private weatherLastFetched: number = 0;
  private static readonly WEATHER_CACHE_MS = 30 * 60 * 1000; // 30 minutes

  constructor(stateDir: string, charName: string, options?: { weatherApiKey?: string; weatherCity?: string }) {
    this.filePath = `${stateDir}/${charName}-affinity.json`;
    this.state = createDefaultState();
    this.weatherApiKey = options?.weatherApiKey;
    this.weatherCity = options?.weatherCity ?? "Tokyo";
    this.load();
    this.initDailyCounter();
  }

  /**
   * Fetch weather and update the cached weather mood effect.
   * Safe to call frequently — caches for 30 minutes.
   * Failures are silently ignored.
   */
  async refreshWeather(): Promise<void> {
    if (!this.weatherApiKey) return;
    const now = Date.now();
    if (now - this.weatherLastFetched < AffinityManager.WEATHER_CACHE_MS) return;

    try {
      const weather = await fetchWeather(this.weatherApiKey, this.weatherCity);
      this.weatherEffect = getCurrentWeatherMood(weather);
      this.weatherLastFetched = now;
    } catch {
      // Weather fetch failed — keep previous cache or null
    }
  }

  /**
   * Set the weather effect directly (for external callers that already have weather data).
   */
  setWeatherEffect(effect: WeatherMoodEffect | null): void {
    this.weatherEffect = effect;
  }

  /**
   * Get the current weather mood effect (if available).
   */
  getWeatherEffect(): WeatherMoodEffect | null {
    return this.weatherEffect;
  }

  // ---------- Persistence ----------

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AffinityState;
      if (typeof parsed.level !== "number") {
        throw new Error("Invalid affinity state: level is not a number");
      }
      this.state = parsed;
    } catch (e) {
      if (existsSync(this.filePath)) {
        logError("affinity.load", e);
      }
      this.state = createDefaultState();
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
      writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (e) {
      logError("affinity.save", e);
      try {
        writeFileSync(
          this.filePath,
          JSON.stringify(this.state, null, 2),
          "utf-8",
        );
      } catch (e2) {
        logError("affinity.save.fallback", e2);
      }
    }
  }

  // ---------- Daily counter ----------

  private initDailyCounter(): void {
    const now = new Date().toISOString();
    this.todayDate = toDateString(now);

    if (this.state.lastInteraction) {
      const lastDate = toDateString(this.state.lastInteraction);
      if (lastDate === this.todayDate) {
        // Count how many interactions happened today
        // We approximate by storing totalInteractions globally;
        // for accurate daily cap we track in memory, reset on date change
        this.todayInteractionCount = 0; // will be rebuilt from state if needed
      }
    }
  }

  // ---------- Public API ----------

  /**
   * Record a conversation interaction. Call this each time the user chats.
   */
  recordInteraction(): void {
    const now = new Date().toISOString();
    const today = toDateString(now);
    const previousLevel = this.state.level;

    // Reset daily counter if day changed
    if (this.todayDate !== today) {
      this.todayDate = today;
      this.todayInteractionCount = 0;
    }

    // First-ever interaction
    const isFirst = this.state.totalInteractions === 0;

    // Handle streak
    if (this.state.lastInteraction) {
      const lastDate = toDateString(this.state.lastInteraction);
      const daysGap = daysBetween(lastDate, today);

      if (lastDate === today) {
        // Same day — no streak change
      } else if (daysGap === 1) {
        // Consecutive day
        this.state.streak += 1;
        this.applyStreakBonus();
      } else {
        // Gap — reset streak
        this.state.streak = 1;
      }
    } else {
      // First interaction ever
      this.state.streak = 1;
    }

    // Apply interaction gain (capped per day)
    this.todayInteractionCount += 1;
    if (this.todayInteractionCount <= DAILY_INTERACTION_CAP) {
      this.state.level = clamp(
        this.state.level + INTERACTION_GAIN,
        0,
        100,
      );
    }

    this.state.totalInteractions += 1;
    this.state.lastInteraction = now;

    // Check milestones
    if (isFirst) {
      this.addMilestone("first_chat");
    }
    this.checkLevelMilestones();
    this.checkStreakMilestones();

    // Update mood (excited if level just went up)
    if (this.state.level > previousLevel) {
      this.state.mood = "excited";
      this.state.moodUpdatedAt = now;
    } else {
      this.updateMood(now, this.weatherEffect);
    }

    this.save();
  }

  /**
   * Record a news check interaction (smaller gain).
   */
  recordNewsCheck(): void {
    const now = new Date().toISOString();
    const today = toDateString(now);

    if (this.todayDate !== today) {
      this.todayDate = today;
      this.todayInteractionCount = 0;
    }

    if (this.todayInteractionCount < DAILY_INTERACTION_CAP) {
      this.state.level = clamp(this.state.level + NEWS_GAIN, 0, 100);
    }

    this.checkLevelMilestones();
    this.save();
  }

  /**
   * Get the current affinity state.
   */
  getState(): AffinityState {
    // Refresh mood before returning
    this.checkDecay();
    this.updateMood(new Date().toISOString(), this.weatherEffect);
    return { ...this.state };
  }

  /**
   * Return a mood description string suitable for inclusion in the system prompt.
   */
  getMoodContext(): string {
    this.checkDecay();
    this.updateMood(new Date().toISOString(), this.weatherEffect);

    const moodLabel = MOOD_LABELS[this.state.mood] || this.state.mood;
    const weatherComment = this.weatherEffect?.comment
      ? `（天気: ${this.weatherEffect.comment}）`
      : "";
    const streakText =
      this.state.streak > 0 ? `${this.state.streak}日連続会話中` : "";
    const parts = [
      `好感度: ${Math.floor(this.state.level)}/100`,
      streakText,
    ].filter(Boolean);

    return `【現在のあなたの気分】${moodLabel}${weatherComment}（${parts.join("、")}）`;
  }

  /**
   * Return milestones achieved since the last call (for notification).
   * Calling this clears the pending list.
   */
  getNewMilestones(): string[] {
    const milestones = [...this.pendingMilestones];
    this.pendingMilestones = [];
    return milestones;
  }

  /**
   * Apply decay and mood update, then persist the result.
   * Use this from external schedulers that need the side-effects saved.
   */
  applyDecayAndSave(): AffinityState {
    this.checkDecay();
    this.updateMood(new Date().toISOString(), this.weatherEffect);
    this.save();
    return { ...this.state };
  }

  /**
   * Check and apply affinity decay from inactivity.
   */
  checkDecay(): void {
    if (!this.state.lastInteraction) return;

    const now = new Date().toISOString();
    const today = toDateString(now);
    const lastDate = toDateString(this.state.lastInteraction);
    const daysGap = daysBetween(lastDate, today);

    if (daysGap >= DECAY_THRESHOLD_DAYS) {
      const decayDays = daysGap - DECAY_THRESHOLD_DAYS + 1;
      const totalDecay = decayDays * DECAY_PER_DAY;
      this.state.level = clamp(this.state.level - totalDecay, 0, 100);

      // Reset streak on long absence
      if (daysGap >= 2) {
        this.state.streak = 0;
      }
    }
  }

  // ---------- Internal ----------

  private applyStreakBonus(): void {
    for (const tier of STREAK_BONUSES) {
      if (this.state.streak === tier.days) {
        this.state.level = clamp(this.state.level + tier.bonus, 0, 100);
        break;
      }
    }
  }

  private updateMood(nowIso: string, weatherEffect?: WeatherMoodEffect | null): void {
    // 3+ days no interaction -> lonely
    if (this.state.lastInteraction) {
      const daysGap = daysBetween(
        toDateString(this.state.lastInteraction),
        toDateString(nowIso),
      );
      if (daysGap >= DECAY_THRESHOLD_DAYS) {
        this.state.mood = "lonely";
        this.state.moodUpdatedAt = nowIso;
        return;
      }
    }

    // If mood was recently set to "excited", keep it for a bit
    if (this.state.mood === "excited" && this.state.moodUpdatedAt) {
      const elapsed =
        new Date(nowIso).getTime() -
        new Date(this.state.moodUpdatedAt).getTime();
      if (elapsed < 5 * 60 * 1000) {
        // Keep excited for 5 minutes
        return;
      }
    }

    const hour = new Date(nowIso).getHours();
    const highAffinity = this.state.level >= 50;

    // Base mood from time of day
    let baseMood: Mood;
    if (hour >= 23 || hour < 6) {
      // 深夜
      baseMood = "tired";
    } else if (hour >= 6 && hour < 10) {
      // 朝
      baseMood = highAffinity ? "happy" : "curious";
    } else if (hour >= 10 && hour < 18) {
      // 昼
      baseMood = highAffinity ? "happy" : "neutral";
    } else {
      // 夜 (18-23)
      baseMood = highAffinity ? "neutral" : "tired";
    }

    // Apply weather influence (weather can override base mood)
    if (weatherEffect?.moodBoost) {
      const targetMood = weatherEffect.moodBoost.mood as Mood;
      // Weather boost applies with some probability based on weight
      // If weather mood matches a valid Mood type, apply it
      if (["happy", "tired", "curious", "neutral", "lonely", "excited"].includes(targetMood)) {
        // Weather overrides base mood during daytime (6-23), not deep night
        if (!(hour >= 23 || hour < 6)) {
          baseMood = targetMood;
        }
      }
    }

    this.state.mood = baseMood;
    this.state.moodUpdatedAt = nowIso;
  }

  private addMilestone(key: string): void {
    if (!this.state.milestones.includes(key)) {
      this.state.milestones.push(key);
      this.pendingMilestones.push(key);
    }
  }

  private checkLevelMilestones(): void {
    for (const m of LEVEL_MILESTONES) {
      if (
        this.state.level >= m.threshold &&
        !this.state.milestones.includes(m.key)
      ) {
        this.addMilestone(m.key);
      }
    }
  }

  private checkStreakMilestones(): void {
    for (const m of STREAK_MILESTONES) {
      if (
        this.state.streak >= m.threshold &&
        !this.state.milestones.includes(m.key)
      ) {
        this.addMilestone(m.key);
      }
    }
  }
}
