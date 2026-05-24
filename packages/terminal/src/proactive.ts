import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  CompanionAI,
  loadCharacter,
  fetchNews,
  formatNewsContext,
  fetchQiitaTrending,
  formatQiitaContext,
  ContentCache,
  OpenPetsClient,
  UnifiedVoiceSynthesizer,
  NewsCurator,
} from "@ai-companion/core";
import type { VoiceEngine } from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
config({ path: resolve(ROOT, ".env") });

const mode = process.argv[2] as string | undefined;

function shouldTrigger(): boolean {
  if (mode) return true;

  const hour = new Date().getHours();

  // 深夜 (23-6): ほぼ発言しない
  if (hour >= 23 || hour < 6) return Math.random() < 0.05;

  // 前回の発言から5分以内: スキップ
  try {
    const lastRunFile = resolve(ROOT, ".state/last-proactive.txt");
    const lastTime = parseInt(readFileSync(lastRunFile, "utf-8").trim());
    if (Date.now() - lastTime < 5 * 60 * 1000) return false;
  } catch {}

  // 朝 (6-9): 高め
  if (hour >= 6 && hour < 9) return Math.random() < 0.4;
  // 日中 (9-18): 通常
  if (hour >= 9 && hour < 18) return Math.random() < 0.25;
  // 夕方〜夜 (18-23): やや控えめ
  return Math.random() < 0.2;
}

if (!shouldTrigger()) {
  process.exit(0);
}

const charName = process.env.COMPANION_CHAR ?? "rei";
const charPath = resolve(ROOT, `characters/${charName}.yaml`);
const stateDir = resolve(ROOT, ".state");
const historyPath = resolve(stateDir, `${charName}-history.json`);
const character = loadCharacter(charPath);
const ai = new CompanionAI(character, undefined, historyPath);
const cache = new ContentCache(stateDir);
const openpets = new OpenPetsClient();
const voiceEngine = (character.voice?.engine ?? "aivisspeech") as VoiceEngine;
const voice = new UnifiedVoiceSynthesizer({
  engine: voiceEngine,
  aivisspeech: {
    speakerId: character.voice?.speaker_id,
    speedScale: character.voice?.speed,
    pitchScale: character.voice?.pitch,
    volumeScale: character.voice?.volume,
  },
  fishSpeech: character.voice?.fish_speech
    ? {
        referenceId: character.voice.fish_speech.reference_id,
        chunkLength: character.voice.fish_speech.chunk_length,
        temperature: character.voice.fish_speech.temperature,
        prosody: character.voice.fish_speech.prosody,
      }
    : undefined,
});

const CACHE_30MIN = 30 * 60 * 1000;
const CACHE_1HOUR = 60 * 60 * 1000;

type Mode = "news" | "qiita" | "work" | "casual" | "curate";

// --- #4: 時間帯別モード選択 ---
function pickMode(): Mode {
  if (mode && ["news", "qiita", "work", "casual", "curate"].includes(mode)) {
    return mode as Mode;
  }
  const hour = new Date().getHours();

  // 深夜・早朝 → 雑談（体調気遣い）優先
  if (hour >= 23 || hour < 6) return "casual";

  // 昼時 → 雑談（食事促し）が出やすい
  if (hour >= 12 && hour < 13 && Math.random() < 0.6) return "casual";

  // 長時間作業検知
  const lastRunFile = resolve(stateDir, "last-proactive.txt");
  try {
    const lastTime = parseInt(readFileSync(lastRunFile, "utf-8").trim());
    const elapsed = Date.now() - lastTime;
    // 2時間以上経過 → 休憩を促す
    if (elapsed > 2 * 60 * 60 * 1000 && Math.random() < 0.5) return "casual";
  } catch {}

  const modes: Mode[] = ["news", "qiita", "work", "casual", "curate"];
  const weights = [2, 3, 2, 2, 3];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < modes.length; i++) {
    r -= weights[i];
    if (r <= 0) return modes[i];
  }
  return "casual";
}

// --- #1: 強化された作業コンテキスト ---
function getWorkContext(): string {
  const parts: string[] = [];

  try {
    const log = execSync("git log --oneline -5 2>nul", {
      cwd: ROOT, encoding: "utf-8", timeout: 5000,
    }).trim();
    if (log) parts.push(`最近のコミット:\n${log}`);
  } catch {}

  try {
    const diff = execSync("git diff --stat 2>nul", {
      cwd: ROOT, encoding: "utf-8", timeout: 5000,
    }).trim();
    if (diff) parts.push(`未コミットの変更:\n${diff}`);
  } catch {}

  try {
    const branch = execSync("git branch --show-current 2>nul", {
      cwd: ROOT, encoding: "utf-8", timeout: 5000,
    }).trim();
    if (branch) parts.push(`ブランチ: ${branch}`);
  } catch {}

  return parts.join("\n\n");
}

// --- #4: 時間帯コンテキスト ---
function getCasualContext(): string {
  const hour = new Date().getHours();
  const day = new Date().getDay();
  const isWeekend = day === 0 || day === 6;

  if (hour >= 23 || hour < 5) {
    return "深夜です。ユーザーがまだ起きています。「もう遅いから寝たほうがいいよ」「無理しないでね」のような体を気遣う一言を自然に。";
  }
  if (hour < 7) {
    return "早朝です。「早起きだね」のような軽い一言を。";
  }
  if (hour < 10) {
    return "朝です。一日の始まりに短く声をかけてください。";
  }
  if (hour >= 12 && hour < 13) {
    return "お昼時です。「ご飯食べた？」「お腹空かない？」のように食事を促す一言を自然に。";
  }
  if (hour >= 15 && hour < 16) {
    return "午後3時頃です。「ちょっと休憩したら？」のような軽い声かけを。";
  }
  if (hour >= 18 && hour < 20) {
    return isWeekend
      ? "週末の夕方です。リラックスを促す一言を。"
      : "夕方です。「今日もお疲れさま」のような一言を。";
  }

  // 長時間作業の検知
  try {
    const lastTime = parseInt(readFileSync(resolve(stateDir, "last-proactive.txt"), "utf-8").trim());
    if (Date.now() - lastTime > 2 * 60 * 60 * 1000) {
      return "ユーザーが長時間作業しています。「ちょっと休憩したら？目疲れてない？」のように休憩を促してください。";
    }
  } catch {}

  return "ユーザーが作業中です。短く自然に声をかけてください。";
}

async function run() {
  const selected = pickMode();
  let context = "";
  let reaction = "idle";

  switch (selected) {
    case "news": {
      // #2: キャッシュ（30分）
      const cached = cache.get<{ formatted: string }>("news", CACHE_30MIN);
      if (cached && !cached.isNew) {
        const items = await fetchNews();
        const formatted = formatNewsContext(items);
        const isNew = cache.set("news", { formatted });
        if (!isNew) {
          // 同じニュースなのでスキップ
          process.exit(0);
        }
        context = formatted;
      } else if (cached) {
        context = cached.data.formatted;
      } else {
        const items = await fetchNews();
        const formatted = formatNewsContext(items);
        cache.set("news", { formatted });
        context = formatted;
      }
      reaction = "thinking";
      break;
    }
    case "qiita": {
      // #2: キャッシュ（1時間）
      const cached = cache.get<{ formatted: string }>("qiita", CACHE_1HOUR);
      if (cached) {
        context = cached.data.formatted;
      } else {
        const items = await fetchQiitaTrending(5);
        const formatted = formatQiitaContext(items);
        if (formatted) {
          cache.set("qiita", { formatted });
          context = formatted;
        } else {
          const news = await fetchNews();
          context = formatNewsContext(news);
        }
      }
      reaction = "thinking";
      break;
    }
    case "work": {
      const activity = getWorkContext();
      context = activity
        ? `ユーザーの最近の開発活動:\n${activity}\n\nこの作業内容を見て、短く感想や提案を述べてください。具体的なファイル名やコミット内容に触れると良い。`
        : "ユーザーが作業中です。短く声をかけてください。";
      reaction = "working";
      break;
    }
    case "curate": {
      const curator = new NewsCurator(stateDir);
      const article = await curator.curate();
      if (!article) {
        // Curator throttled or no new articles — fall back to casual
        context = getCasualContext();
        reaction = "waving";
        break;
      }
      context = `注目ニュースを紹介してください:
タイトル: ${article.title}
ソース: ${article.source}
注目理由: ${article.reason}

キャラクターとして1-2文で紹介してください。`;
      reaction = "thinking";
      break;
    }
    case "casual": {
      context = getCasualContext();
      reaction = "waving";
      break;
    }
  }

  if (!context) process.exit(0);

  const { text, reaction: aiReaction } = await ai.proactiveMessage(context);
  const label = { news: "📰", qiita: "📝", work: "💻", casual: "💬", curate: "🗞️" }[selected];
  console.log(`\n${label} ${character.display_name}: ${text}`);

  // ステート保存
  try { mkdirSync(stateDir, { recursive: true }); } catch {}
  writeFileSync(resolve(stateDir, "last-message.txt"), text, "utf-8");
  writeFileSync(resolve(stateDir, "last-proactive.txt"), Date.now().toString(), "utf-8");

  await Promise.all([
    openpets.say(text, aiReaction).catch(() => {}),
    voice.speak(text, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});
}

run().catch(() => process.exit(0));
