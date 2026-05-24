#!/usr/bin/env npx tsx
/**
 * create-character.ts — 対話的にキャラクターYAMLを生成するスクリプト
 *
 * Usage:
 *   npx tsx scripts/create-character.ts
 */
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const CHARACTERS_DIR = path.resolve(process.cwd(), "characters");

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function toYamlMultiline(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

async function main(): Promise<void> {
  const rl = createRL();

  console.log("=== AI Companion キャラクター作成 ===\n");

  const name = await ask(rl, "キャラクター名 (英字, ファイル名に使用): ");
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.error("エラー: 英数字・ハイフン・アンダースコアのみ使用できます");
    rl.close();
    process.exit(1);
  }

  const outputPath = path.join(CHARACTERS_DIR, `${name}.yaml`);
  if (fs.existsSync(outputPath)) {
    const overwrite = await ask(
      rl,
      `${name}.yaml は既に存在します。上書きしますか？ (y/N): `,
    );
    if (overwrite.toLowerCase() !== "y") {
      console.log("中止しました。");
      rl.close();
      process.exit(0);
    }
  }

  const displayName = await ask(rl, "表示名 (例: 綾波レイ): ");
  const personality = await ask(
    rl,
    "性格 (1行で簡潔に。例: 落ち着いていて知的な20代女性): ",
  );
  const firstPerson = (await ask(rl, "一人称 (例: 私, 僕, わたし) [私]: ")) || "私";
  const speechStyle = await ask(
    rl,
    "口調 (例: タメ口で自然に話す / です・ます調で丁寧に): ",
  );

  const greetingMorning =
    (await ask(rl, "朝の挨拶 [おはよう]: ")) || "おはよう";
  const greetingAfternoon =
    (await ask(rl, "昼の挨拶 [お疲れさま]: ")) || "お疲れさま";
  const greetingEvening =
    (await ask(rl, "夕方の挨拶 [おかえり]: ")) || "おかえり";
  const greetingNight =
    (await ask(rl, "夜の挨拶 [おやすみ]: ")) || "おやすみ";

  rl.close();

  const yaml = `name: "${name}"
display_name: "${displayName}"
personality: |
${toYamlMultiline(personality)}
first_person: "${firstPerson}"
speech_style: |
${toYamlMultiline(speechStyle)}
greeting:
  morning: ${greetingMorning}
  afternoon: ${greetingAfternoon}
  evening: ${greetingEvening}
  night: ${greetingNight}
weather_comment_style: |
  天気に触れるときは自然に、友達に話すように。
news_comment_style: |
  ニュースを伝えるときは、面白いポイントだけ簡潔に。
voice:
  speaker_id: 1878365376
  speed: 1.0
  pitch: 0.0
  volume: 0.3
`;

  fs.mkdirSync(CHARACTERS_DIR, { recursive: true });
  fs.writeFileSync(outputPath, yaml, "utf-8");
  console.log(`\nキャラクターファイルを作成しました: ${outputPath}`);
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
