import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  CompanionAI,
  loadCharacter,
  OpenPetsClient,
  UnifiedVoiceSynthesizer,
  setLogDir,
  fetchWeather,
  formatWeatherContext,
  NewsCurator,
  AffinityManager,
  MemoryManager,
} from "@ai-companion/core";
import type { VoiceEngine } from "@ai-companion/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

/** Resolve character name: COMPANION_CHAR env > .state/active-character.txt > "rei" */
function resolveCharName(): string {
  if (process.env.COMPANION_CHAR) return process.env.COMPANION_CHAR;
  const activeFile = resolve(__dirname, "../../../.state/active-character.txt");
  try {
    const saved = readFileSync(activeFile, "utf-8").trim();
    if (saved) return saved;
  } catch {
    // file doesn't exist yet
  }
  return "rei";
}

const charName = resolveCharName();
const charPath = resolve(__dirname, `../../../characters/${charName}.yaml`);
if (!existsSync(charPath)) {
  console.error(`キャラクターファイルが見つかりません: ${charPath}`);
  process.exit(1);
}

const historyPath = resolve(
  __dirname,
  `../../../.state/${charName}-history.json`,
);
const stateDir = resolve(__dirname, "../../../.state");
setLogDir(stateDir);
const character = loadCharacter(charPath);
const ai = new CompanionAI(character, undefined, historyPath);
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

const message = process.argv.slice(2).join(" ");

if (!message) {
  const greeting = ai.getGreeting();
  console.log(greeting);
  await Promise.all([
    openpets.say(greeting, "waving").catch(() => {}),
    voice.speak(greeting, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});
  process.exit(0);
}

// --- Command handling ---

interface CommandDef {
  description: string;
  handler: (args: string) => Promise<void>;
}

const commands: Record<string, CommandDef> = {
  weather: {
    description: "天気を聞く",
    handler: handleWeather,
  },
  news: {
    description: "最新ニュースを1本紹介",
    handler: handleNews,
  },
  mood: {
    description: "現在のムードと好感度を表示",
    handler: handleMood,
  },
  stats: {
    description: "簡易統計表示（総会話数、連続日数）",
    handler: handleStats,
  },
  topics: {
    description: "最近のトピックを表示",
    handler: handleTopics,
  },
  history: {
    description: "直近N件の会話を表示 (例: /history 5)",
    handler: handleHistory,
  },
  help: {
    description: "コマンド一覧を表示",
    handler: handleHelp,
  },
};

async function handleWeather(): Promise<void> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    console.log("⚠️ OPENWEATHER_API_KEY が設定されていません。");
    return;
  }
  const weather = await fetchWeather(apiKey);
  const context = formatWeatherContext(weather);
  const { text, reaction } = await ai.proactiveMessage(context);
  console.log(text);
  await Promise.all([
    openpets.say(text, reaction).catch(() => {}),
    voice.speak(text, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});
}

async function handleNews(): Promise<void> {
  const curator = new NewsCurator(stateDir);
  const article = await curator.curate({ force: true });
  if (!article) {
    console.log("新しいニュースが見つかりませんでした。");
    return;
  }
  const context = `注目ニュースを紹介してください:
タイトル: ${article.title}
ソース: ${article.source}
注目理由: ${article.reason}

キャラクターとして1-2文で紹介してください。`;
  const { text, reaction } = await ai.proactiveMessage(context);
  console.log(`📰 ${article.source}: ${article.title}`);
  console.log(`   ${text}`);
  console.log(`   🔗 ${article.url}`);
  await Promise.all([
    openpets.say(text, reaction).catch(() => {}),
    voice.speak(text, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});
}

async function handleMood(): Promise<void> {
  const affinity = new AffinityManager(stateDir, charName);
  const state = affinity.getState();

  const moodLabels: Record<string, string> = {
    neutral: "落ち着いている",
    happy: "嬉しい",
    curious: "興味深い",
    tired: "少し疲れている",
    lonely: "寂しい",
    excited: "テンションが高い",
  };

  const moodLabel = moodLabels[state.mood] ?? state.mood;
  console.log(`\n🎭 ムード: ${moodLabel}`);
  console.log(`💕 好感度: ${Math.floor(state.level)}/100`);
  console.log(`🔥 連続日数: ${state.streak}日`);
  if (state.milestones.length > 0) {
    console.log(`🏆 マイルストーン: ${state.milestones.join(", ")}`);
  }
  console.log();
}

async function handleStats(): Promise<void> {
  const affinity = new AffinityManager(stateDir, charName);
  const state = affinity.getState();

  console.log(`\n📊 統計情報`);
  console.log(`   総会話数: ${state.totalInteractions}回`);
  console.log(`   連続日数: ${state.streak}日`);
  console.log(`   好感度: ${Math.floor(state.level)}/100`);
  if (state.lastInteraction) {
    const last = new Date(state.lastInteraction);
    console.log(`   最終会話: ${last.toLocaleString("ja-JP")}`);
  }
  console.log();
}

async function handleTopics(): Promise<void> {
  const memoryPath = resolve(stateDir, `${charName}-history.json`);
  const memory = new MemoryManager(memoryPath);
  const context = memory.getMemoryContext();

  if (!context) {
    console.log("まだトピックが記録されていません。");
    return;
  }
  console.log(`\n${context}\n`);
}

async function handleHistory(args: string): Promise<void> {
  const n = parseInt(args) || 10;
  const memoryPath = resolve(stateDir, `${charName}-history.json`);

  let history: Array<{ role: string; content: string }> = [];
  try {
    history = JSON.parse(readFileSync(memoryPath, "utf-8"));
  } catch {
    console.log("会話履歴がまだありません。");
    return;
  }

  const recent = history.slice(-n);
  if (recent.length === 0) {
    console.log("会話履歴がまだありません。");
    return;
  }

  console.log(`\n📜 直近${recent.length}件の会話:\n`);
  for (const msg of recent) {
    const label = msg.role === "user" ? "あなた" : character.display_name;
    const content =
      msg.content.length > 100
        ? msg.content.slice(0, 100) + "..."
        : msg.content;
    console.log(`  [${label}] ${content}`);
  }
  console.log();
}

async function handleHelp(): Promise<void> {
  console.log(`\n📋 コマンド一覧:\n`);
  for (const [name, def] of Object.entries(commands)) {
    console.log(`  /${name.padEnd(10)} ${def.description}`);
  }
  console.log(`\nコマンド以外のメッセージは通常の会話として処理されます。\n`);
}

// --- Main dispatch ---

if (message.startsWith("/")) {
  const [cmd, ...rest] = message.slice(1).split(/\s+/);
  const args = rest.join(" ");
  const command = commands[cmd.toLowerCase()];

  if (command) {
    await command.handler(args);
  } else {
    console.log(`不明なコマンド: /${cmd}`);
    console.log(`/help でコマンド一覧を表示できます。`);
  }
} else {
  // Normal conversation
  const { text, reaction } = await ai.chat(message);
  console.log(text);

  await Promise.all([
    openpets.say(text, reaction).catch(() => {}),
    voice.speak(text, stateDir).catch(() => {}),
  ]);
  await openpets.react("idle").catch(() => {});

  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {}
  writeFileSync(resolve(stateDir, "last-message.txt"), text, "utf-8");
}
