import { readFileSync, existsSync } from "fs";
import { logError } from "./logger.js";

export interface StatsData {
  totalMessages: number;
  totalDays: number;
  avgMessagesPerDay: number;
  longestStreak: number;
  currentStreak: number;
  favoriteTopics: { topic: string; count: number }[];
  activeHours: { hour: number; count: number }[];
  weekdayActivity: { day: string; count: number }[];
  moodHistory: { date: string; mood: string }[];
  levelHistory: { date: string; level: number }[];
}

interface HistoryMessage {
  role: string;
  content: string;
  timestamp?: string;
}

interface AffinityState {
  level: number;
  totalInteractions: number;
  streak: number;
  lastInteraction: string;
  mood: string;
  milestones: string[];
}

interface TimelineEvent {
  id: string;
  type: string;
  timestamp: string;
  summary: string;
  details?: string;
}

interface UserMemoryState {
  facts: Array<{
    id: string;
    category: string;
    content: string;
    createdAt: string;
    confidence: number;
  }>;
  updatedAt: string;
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (e) {
    logError("stats.readJson", e);
    return null;
  }
}

export class ConversationStats {
  private stateDir: string;
  private charName: string;

  constructor(stateDir: string, charName: string) {
    this.stateDir = stateDir;
    this.charName = charName;
  }

  calculate(): StatsData {
    const history = this.loadHistory();
    const affinity = this.loadAffinity();
    const timeline = this.loadTimeline();
    const userMemory = this.loadUserMemory();

    const totalMessages = history.length;
    const { totalDays, avgMessagesPerDay } = this.calcDayStats(history, timeline);
    const { longestStreak, currentStreak } = this.calcStreaks(affinity, timeline);
    const favoriteTopics = this.calcFavoriteTopics(userMemory);
    const activeHours = this.calcActiveHours(history, timeline);
    const weekdayActivity = this.calcWeekdayActivity(history, timeline);
    const moodHistory = this.calcMoodHistory(timeline);
    const levelHistory = this.calcLevelHistory(timeline, affinity);

    return {
      totalMessages,
      totalDays,
      avgMessagesPerDay,
      longestStreak,
      currentStreak,
      favoriteTopics,
      activeHours,
      weekdayActivity,
      moodHistory,
      levelHistory,
    };
  }

  private loadHistory(): HistoryMessage[] {
    const filePath = this.stateDir + "/" + this.charName + "-history.json";
    const data = readJsonSafe<HistoryMessage[]>(filePath);
    return Array.isArray(data) ? data : [];
  }

  private loadAffinity(): AffinityState | null {
    const filePath = this.stateDir + "/" + this.charName + "-affinity.json";
    return readJsonSafe<AffinityState>(filePath);
  }

  private loadTimeline(): TimelineEvent[] {
    const filePath = this.stateDir + "/" + this.charName + "-timeline.json";
    const data = readJsonSafe<TimelineEvent[]>(filePath);
    return Array.isArray(data) ? data : [];
  }

  private loadUserMemory(): UserMemoryState | null {
    const filePath = this.stateDir + "/" + this.charName + "-user-memory.json";
    return readJsonSafe<UserMemoryState>(filePath);
  }

  private calcDayStats(
    history: HistoryMessage[],
    timeline: TimelineEvent[],
  ): { totalDays: number; avgMessagesPerDay: number } {
    const dates = new Set<string>();

    for (const msg of history) {
      if (msg.timestamp) {
        const date = msg.timestamp.slice(0, 10);
        if (date.length === 10) dates.add(date);
      }
    }

    for (const evt of timeline) {
      if (evt.timestamp) {
        const date = evt.timestamp.slice(0, 10);
        if (date.length === 10) dates.add(date);
      }
    }

    const totalDays = dates.size || 1;
    const totalMessages = history.length;
    const avgMessagesPerDay = Math.round((totalMessages / totalDays) * 10) / 10;

    return { totalDays, avgMessagesPerDay };
  }

  private calcStreaks(
    affinity: AffinityState | null,
    timeline: TimelineEvent[],
  ): { longestStreak: number; currentStreak: number } {
    const currentStreak = affinity?.streak ?? 0;

    const chatDates = new Set<string>();
    for (const evt of timeline) {
      if (evt.type === "chat" && evt.timestamp) {
        chatDates.add(evt.timestamp.slice(0, 10));
      }
    }

    if (chatDates.size === 0) {
      return { longestStreak: currentStreak, currentStreak };
    }

    const sorted = [...chatDates].sort();
    let longest = 1;
    let streak = 1;

    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]);
      const curr = new Date(sorted[i]);
      const diffMs = curr.getTime() - prev.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        streak++;
        if (streak > longest) longest = streak;
      } else {
        streak = 1;
      }
    }

    const longestStreak = Math.max(longest, currentStreak);

    return { longestStreak, currentStreak };
  }

  private calcFavoriteTopics(
    userMemory: UserMemoryState | null,
  ): { topic: string; count: number }[] {
    if (!userMemory || !Array.isArray(userMemory.facts)) return [];

    const categoryCount = new Map<string, number>();
    const categoryLabels: Record<string, string> = {
      preference: "好み",
      habit: "習慣",
      work: "仕事",
      interest: "興味",
      personal: "個人情報",
      other: "その他",
    };

    for (const fact of userMemory.facts) {
      const label = categoryLabels[fact.category] || fact.category;
      categoryCount.set(label, (categoryCount.get(label) || 0) + 1);
    }

    return [...categoryCount.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private calcActiveHours(
    history: HistoryMessage[],
    timeline: TimelineEvent[],
  ): { hour: number; count: number }[] {
    const hourCounts = new Array(24).fill(0);

    for (const msg of history) {
      if (msg.timestamp) {
        try {
          const d = new Date(msg.timestamp);
          if (!isNaN(d.getTime())) {
            hourCounts[d.getHours()]++;
          }
        } catch {
          // skip invalid timestamps
        }
      }
    }

    for (const evt of timeline) {
      if (evt.type === "chat" && evt.timestamp) {
        try {
          const d = new Date(evt.timestamp);
          if (!isNaN(d.getTime())) {
            hourCounts[d.getHours()]++;
          }
        } catch {
          // skip invalid timestamps
        }
      }
    }

    return hourCounts.map((count, hour) => ({ hour, count }));
  }

  private calcWeekdayActivity(
    history: HistoryMessage[],
    timeline: TimelineEvent[],
  ): { day: string; count: number }[] {
    const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
    const dayCounts = new Array(7).fill(0);

    for (const msg of history) {
      if (msg.timestamp) {
        try {
          const d = new Date(msg.timestamp);
          if (!isNaN(d.getTime())) {
            dayCounts[d.getDay()]++;
          }
        } catch {
          // skip invalid
        }
      }
    }

    for (const evt of timeline) {
      if (evt.type === "chat" && evt.timestamp) {
        try {
          const d = new Date(evt.timestamp);
          if (!isNaN(d.getTime())) {
            dayCounts[d.getDay()]++;
          }
        } catch {
          // skip invalid
        }
      }
    }

    return dayCounts.map((count, i) => ({ day: dayNames[i], count }));
  }

  private calcMoodHistory(
    timeline: TimelineEvent[],
  ): { date: string; mood: string }[] {
    const moodByDate = new Map<string, string>();

    for (const evt of timeline) {
      const date = evt.timestamp?.slice(0, 10);
      if (!date) continue;

      if (evt.type === "milestone") {
        moodByDate.set(date, "excited");
      } else if (evt.type === "chat" && !moodByDate.has(date)) {
        moodByDate.set(date, "happy");
      }
    }

    return [...moodByDate.entries()]
      .map(([date, mood]) => ({ date, mood }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);
  }

  private calcLevelHistory(
    timeline: TimelineEvent[],
    affinity: AffinityState | null,
  ): { date: string; level: number }[] {
    const chatDates = new Set<string>();
    for (const evt of timeline) {
      if (evt.type === "chat" && evt.timestamp) {
        chatDates.add(evt.timestamp.slice(0, 10));
      }
    }

    const sorted = [...chatDates].sort();
    const currentLevel = affinity?.level ?? 0;

    if (sorted.length === 0) {
      if (currentLevel > 0) {
        return [{ date: new Date().toISOString().slice(0, 10), level: currentLevel }];
      }
      return [];
    }

    const result: { date: string; level: number }[] = [];
    const levelPerDay = sorted.length > 1 ? currentLevel / sorted.length : currentLevel;

    for (let i = 0; i < sorted.length; i++) {
      const approxLevel = Math.min(
        Math.round(levelPerDay * (i + 1) * 10) / 10,
        100,
      );
      result.push({ date: sorted[i], level: approxLevel });
    }

    if (result.length > 0) {
      result[result.length - 1].level = currentLevel;
    }

    return result.slice(-30);
  }
}