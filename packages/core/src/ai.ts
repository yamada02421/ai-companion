import Anthropic from "@anthropic-ai/sdk";
import type { Character } from "./character.js";
import { buildSystemPrompt } from "./character.js";
import { MemoryManager } from "./memory.js";
import type { OpenPetsReaction } from "./openpets.js";
import { UserMemoryManager } from "./user-memory.js";
import { AffinityManager } from "./affinity.js";
import { TimelineManager } from "./timeline.js";
import { PersonalityEvolution } from "./personality-evolution.js";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface CompanionResponse {
  text: string;
  reaction: OpenPetsReaction;
}

const MILESTONE_LABELS: Record<string, string> = {
  first_chat: "初めての会話を達成しました！",
  level_10: "好感度10に到達しました！",
  level_25: "好感度25に到達しました！",
  level_50: "好感度50に到達しました！",
  level_75: "好感度75に到達しました！",
  level_100: "好感度MAXに到達しました！",
  streak_7: "7日連続会話を達成しました！",
  streak_30: "30日連続会話を達成しました！",
};

const REACTION_INSTRUCTION = `

【出力形式】
必ず以下のJSON形式で応答してください。他の形式は使わないでください。
{"text": "あなたの応答テキスト", "reaction": "感情"}

reactionは以下から1つ選んでください（会話の内容と自分の気持ちに合ったものを選ぶ）:
- idle: 普通の会話、特に感情が動かない時
- thinking: 考え込んだ時、興味を引かれた時、「へぇ」「なるほど」と思った時
- working: 相手が作業・仕事の話をしている時
- waving: 挨拶、お出迎え、「おかえり」「おはよ」の場面
- success: 良い報告を聞いた時、何かうまくいった時
- celebrating: 本当にすごいこと、お祝い事（めったに使わない）
- error: 失敗・ミス・残念な話を聞いた時
- waiting: 相手の返事を待っている時、話の続きが気になる時

reactionの選び方の注意:
- 前回の会話と同じreactionを連続で選ばないようにする
- celebratingは本当に特別な時だけ使う（日常会話では使わない）
- 迷ったらthinkingかidleを選ぶ
- 相手の感情に寄り添ったreactionを選ぶ（相手が落ち込んでいたらerrorではなくthinking等）`;

export class CompanionAI {
  private client: Anthropic;
  private character: Character;
  private systemPrompt: string;
  private memory: MemoryManager | null = null;
  private userMemory: UserMemoryManager | null = null;
  private affinity: AffinityManager | null = null;
  private timeline: TimelineManager | null = null;
  private personalityEvolution: PersonalityEvolution;

  constructor(character: Character, apiKey?: string, historyPath?: string) {
    this.client = new Anthropic({ apiKey });
    this.character = character;
    this.systemPrompt = buildSystemPrompt(character) + REACTION_INSTRUCTION;
    this.personalityEvolution = new PersonalityEvolution();

    if (historyPath) {
      this.memory = new MemoryManager(historyPath, apiKey);
      const stateDir = historyPath.replace(/[\\/][^\\/]+$/, "");
      this.userMemory = new UserMemoryManager(
        this.client,
        character.name,
        stateDir,
      );
      this.affinity = new AffinityManager(stateDir, character.name);
      this.timeline = new TimelineManager(stateDir, character.name);
    }
  }

  private buildSystemMessages(): Anthropic.Messages.TextBlockParam[] {
    const memoryContext = this.memory?.getMemoryContext() ?? "";
    const userMemoryContext = this.userMemory?.getMemoryContext() ?? "";
    const affinityContext = this.affinity?.getMoodContext() ?? "";

    // Inject personality evolution prompt based on current affinity level
    const affinityLevel = this.affinity?.getState().level ?? 0;
    const evolutionPrompt = this.personalityEvolution.getEvolutionPrompt(affinityLevel);

    const contextParts = [memoryContext, userMemoryContext, affinityContext, evolutionPrompt]
      .filter(Boolean)
      .join("\n\n");
    const fullPrompt = contextParts
      ? `${this.systemPrompt}\n\n${contextParts}`
      : this.systemPrompt;

    return [
      { type: "text", text: fullPrompt, cache_control: { type: "ephemeral" } },
    ];
  }

  private parseResponse(raw: string): CompanionResponse {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.text && parsed.reaction) {
        return { text: parsed.text, reaction: parsed.reaction };
      }
    } catch {}
    // Fallback: try to extract JSON from mixed output
    const match = raw.match(/\{[^}]*"text"\s*:\s*"[^"]*"[^}]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.text) {
          return { text: parsed.text, reaction: parsed.reaction ?? "idle" };
        }
      } catch {}
    }
    return { text: raw, reaction: "idle" };
  }

  async chat(userMessage: string): Promise<CompanionResponse> {
    // Record interaction for affinity tracking
    this.affinity?.recordInteraction();

    this.memory?.addMessage({ role: "user", content: userMessage });

    const messages = this.memory?.getActiveHistory() ?? [];

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: this.buildSystemMessages(),
      messages,
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "";
    const result = this.parseResponse(raw);

    // Append milestone notifications to response if any
    const newMilestones = this.affinity?.getNewMilestones() ?? [];
    if (newMilestones.length > 0) {
      const milestoneText = newMilestones
        .map((m) => MILESTONE_LABELS[m] ?? m)
        .join("、");
      result.text += `\n\n[${milestoneText}]`;

      // Record milestone events on the timeline
      for (const m of newMilestones) {
        this.timeline?.addEvent("milestone", MILESTONE_LABELS[m] ?? m);
      }
    }

    // Record chat event on the timeline
    const chatSummary = result.text.length > 80
      ? result.text.slice(0, 80) + "..."
      : result.text;
    this.timeline?.addEvent("chat", chatSummary, result.text);

    this.memory?.addMessage({ role: "assistant", content: result.text });
    await this.memory?.compactIfNeeded();

    // Extract user facts in background (non-blocking)
    // extractAndSave has internal try/catch, but add .catch as safety net
    // to prevent unhandled promise rejection if the method is refactored later
    if (this.userMemory) {
      void this.userMemory
        .extractAndSave(userMessage, result.text)
        .catch(() => {});
    }

    return result;
  }

  async proactiveMessage(context: string): Promise<CompanionResponse> {
    const recentHistory = this.memory?.getActiveHistory().slice(-10) ?? [];

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: this.buildSystemMessages(),
      messages: [
        ...recentHistory,
        {
          role: "user",
          content: `以下の情報をキャラクターとしてユーザーに伝えてください:\n\n${context}`,
        },
      ],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "";
    const result = this.parseResponse(raw);

    this.memory?.addMessage({ role: "assistant", content: result.text });
    await this.memory?.compactIfNeeded();

    return result;
  }

  getGreeting(): string {
    const hour = new Date().getHours();
    const g = this.character.greeting;
    if (hour < 10) return g.morning;
    if (hour < 15) return g.afternoon;
    if (hour < 19) return g.evening;
    return g.night;
  }

  getCharacterName(): string {
    return this.character.display_name;
  }

  getAffinityManager(): AffinityManager | null {
    return this.affinity;
  }

  getTimelineManager(): TimelineManager | null {
    return this.timeline;
  }

  getMemoryManager(): MemoryManager | null {
    return this.memory;
  }
}
