import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { randomUUID } from "crypto";
import { logError } from "./logger.js";

export type FactCategory =
  | "preference"
  | "habit"
  | "work"
  | "interest"
  | "personal"
  | "other";

export interface UserFact {
  id: string;
  category: FactCategory;
  content: string;
  createdAt: string;
  confidence: number;
}

export interface UserMemoryState {
  facts: UserFact[];
  updatedAt: string;
}

const MAX_FACTS = 100;
const PROMPT_FACT_COUNT = 20;
const MIN_MESSAGE_LENGTH = 4; // Skip extraction for very short messages (e.g. "うん", "はい", "ok")

const VALID_CATEGORIES: readonly FactCategory[] = [
  "preference",
  "habit",
  "work",
  "interest",
  "personal",
  "other",
];

const EXTRACTION_PROMPT = `あなたはユーザーの会話からユーザー個人に関する事実を抽出するアシスタントです。

以下の会話ターン（ユーザーの発言とAIの応答）から、ユーザー自身についての新しい事実を抽出してください。
事実とは、ユーザーの好み、習慣、仕事、興味、名前、生活リズム、性格などの個人情報です。
AIの発言内容や一般的な知識は抽出しないでください。ユーザー個人に関する情報のみです。

既に知っている事実:
{existingFacts}

【ルール】
- 既に知っている事実と意味が同じものは抽出しない
- 直接ユーザーが述べた事実は confidence: 0.9
- 会話の文脈から推測できる事実は confidence: 0.5〜0.7
- カテゴリは preference, habit, work, interest, personal, other のいずれか
- 新しい事実がなければ空配列を返す

【出力形式】
必ず以下のJSON形式のみで応答してください。他のテキストは含めないでください。
{"facts": [{"category": "カテゴリ", "content": "事実の内容", "confidence": 0.9}]}

会話ターン:
ユーザー: {userMessage}
AI: {assistantMessage}`;

export class UserMemoryManager {
  private client: Anthropic;
  private filePath: string;
  private state: UserMemoryState;

  constructor(client: Anthropic, charName: string, stateDir: string) {
    this.client = client;
    this.filePath = `${stateDir}/${charName}-user-memory.json`;
    this.state = { facts: [], updatedAt: "" };
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as UserMemoryState;
      // Validate structure to avoid corrupted data silently passing through
      if (!Array.isArray(parsed.facts)) {
        throw new Error("Invalid user memory: facts is not an array");
      }
      this.state = parsed;
    } catch (e) {
      // If file exists but failed to parse, it may be corrupted — log it
      if (existsSync(this.filePath)) {
        logError("user-memory.load", e);
      }
      this.state = { facts: [], updatedAt: "" };
    }
  }

  private save(): void {
    const dir = this.filePath.replace(/[\\/][^\\/]+$/, "");
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // directory may already exist
    }
    // Atomic write: write to temp file then rename to prevent corruption on crash
    const tmpPath = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync(tmpPath, this.filePath);
    } catch (e) {
      logError("user-memory.save", e);
      // Fallback: direct write if rename fails (e.g. cross-device)
      try {
        writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
      } catch (e2) {
        logError("user-memory.save.fallback", e2);
      }
    }
  }

  getFacts(): UserFact[] {
    return this.state.facts;
  }

  getTopFacts(count: number = PROMPT_FACT_COUNT): UserFact[] {
    return [...this.state.facts]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, count);
  }

  getMemoryContext(): string {
    const topFacts = this.getTopFacts();
    if (topFacts.length === 0) return "";

    const lines = topFacts.map((f) => `- ${f.content}`);
    return `【ユーザーについて知っていること】\n${lines.join("\n")}`;
  }

  async extractAndSave(
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    // Skip extraction for very short messages (greetings, acknowledgements)
    // These rarely contain extractable personal facts
    if (userMessage.trim().length < MIN_MESSAGE_LENGTH) return;

    const existingFactsText =
      this.state.facts.length > 0
        ? this.state.facts.map((f) => `- ${f.content}`).join("\n")
        : "(まだなし)";

    const prompt = EXTRACTION_PROMPT.replace(
      "{existingFacts}",
      existingFactsText,
    )
      .replace("{userMessage}", userMessage)
      .replace("{assistantMessage}", assistantMessage);

    try {
      const res = await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });

      const text = res.content[0].type === "text" ? res.content[0].text : "";

      const parsed = this.parseExtraction(text);
      if (parsed.length === 0) return;

      for (const fact of parsed) {
        this.addFact(fact.category, fact.content, fact.confidence);
      }

      this.enforceLimit();
      this.state.updatedAt = new Date().toISOString();
      this.save();
    } catch (e) {
      logError("user-memory.extract", e);
    }
  }

  private parseExtraction(
    raw: string,
  ): Array<{ category: FactCategory; content: string; confidence: number }> {
    const results: Array<{
      category: FactCategory;
      content: string;
      confidence: number;
    }> = [];

    try {
      // Try to extract JSON from the response
      const jsonMatch = raw.match(/\{[\s\S]*"facts"[\s\S]*\}/);
      if (!jsonMatch) return results;

      const parsed = JSON.parse(jsonMatch[0]) as {
        facts?: Array<{
          category?: string;
          content?: string;
          confidence?: number;
        }>;
      };

      if (!Array.isArray(parsed.facts)) return results;

      for (const item of parsed.facts) {
        if (!item.content || typeof item.content !== "string") continue;

        const category = VALID_CATEGORIES.includes(
          item.category as FactCategory,
        )
          ? (item.category as FactCategory)
          : "other";

        const confidence =
          typeof item.confidence === "number"
            ? Math.max(0, Math.min(1, item.confidence))
            : 0.5;

        results.push({
          category,
          content: item.content.trim(),
          confidence,
        });
      }
    } catch {
      // JSON parse failure: return empty
    }

    return results;
  }

  private addFact(
    category: FactCategory,
    content: string,
    confidence: number,
  ): void {
    // Simple text-based dedup: skip if very similar content already exists
    const normalized = content.toLowerCase().replace(/\s+/g, "");
    if (normalized.length === 0) return;

    const isDuplicate = this.state.facts.some((f) => {
      const existing = f.content.toLowerCase().replace(/\s+/g, "");
      // Exact match
      if (existing === normalized) return true;
      // Substring containment — only apply when the shorter string is long enough
      // to be meaningful (>= 8 chars), otherwise "猫好き" would match "猫好きで犬も好き"
      const shorter = Math.min(existing.length, normalized.length);
      if (shorter >= 8) {
        if (existing.includes(normalized) || normalized.includes(existing))
          return true;
      }
      return false;
    });

    if (isDuplicate) return;

    this.state.facts.push({
      id: randomUUID(),
      category,
      content,
      createdAt: new Date().toISOString(),
      confidence,
    });
  }

  private enforceLimit(): void {
    if (this.state.facts.length <= MAX_FACTS) return;

    // Sort by confidence ascending, then by createdAt ascending (oldest first)
    // Remove the lowest-confidence, oldest facts
    const sorted = [...this.state.facts].sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence - b.confidence;
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });

    const toRemove = sorted.slice(0, this.state.facts.length - MAX_FACTS);
    const removeIds = new Set(toRemove.map((f) => f.id));
    this.state.facts = this.state.facts.filter((f) => !removeIds.has(f.id));
  }
}
