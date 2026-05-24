import type { OpenPetsReaction } from "./openpets.js";
import type { EmotionBias } from "./character.js";

interface EmotionRule {
  patterns: RegExp[];
  reaction: OpenPetsReaction;
}

const defaultRules: EmotionRule[] = [
  {
    reaction: "celebrating",
    patterns: [
      /おめでとう|やった|すごい|完了|達成|成功|最高|素晴らしい/,
      /🎉|🎊|✨|💯|🏆/,
    ],
  },
  {
    reaction: "error",
    patterns: [
      /エラー|失敗|バグ|問題|障害|壊れ|ダメ|残念/,
      /error|fail|bug|crash/i,
    ],
  },
  {
    reaction: "thinking",
    patterns: [
      /考え|調べ|確認|検討|分析|調査|なるほど|ふーん|そうだね/,
      /う[ー〜]ん|むむ|どう(しよう|かな)|悩/,
    ],
  },
  {
    reaction: "working",
    patterns: [
      /作業|実装|コード|修正|更新|追加|開発|頑張/,
      /commit|push|deploy|build/i,
    ],
  },
  {
    reaction: "waving",
    patterns: [
      /おはよう|こんにちは|こんばんは|おやすみ|ただいま|おかえり/,
      /お疲れ|休憩|ご飯|食べ/,
    ],
  },
  {
    reaction: "success",
    patterns: [/できた|完成|解決|OK|オッケー|大丈夫|うまくいっ/],
  },
  {
    reaction: "waiting",
    patterns: [/待っ|まだ|もう少し|準備|そろそろ/],
  },
];

const negationPatterns: RegExp[] = [
  /(?:エラー|問題|失敗|バグ)(?:は|も|が)?(?:ない|なく|なし|なかった|ありません|解決)/,
  /(?:直し|修正し|解決し)(?:た|たよ|ました)/,
];

export function detectEmotion(
  text: string,
  bias?: EmotionBias,
): OpenPetsReaction {
  const rules = buildRules(bias);

  for (const rule of rules) {
    if (rule.patterns.some((p) => p.test(text))) {
      const reaction = rule.reaction;
      if (bias?.suppress?.includes(reaction)) {
        continue;
      }
      // Negation check: if "error" matched but context is positive, skip
      if (reaction === "error" && negationPatterns.some((p) => p.test(text))) {
        continue;
      }
      return reaction;
    }
  }

  return (bias?.default_reaction as OpenPetsReaction) ?? "idle";
}

function buildRules(bias?: EmotionBias): EmotionRule[] {
  if (!bias?.custom_patterns) return defaultRules;

  const customRules: EmotionRule[] = Object.entries(bias.custom_patterns).map(
    ([reaction, patterns]) => ({
      reaction: reaction as OpenPetsReaction,
      patterns: patterns.map((p) => new RegExp(p)),
    }),
  );

  const amplified = new Set(bias.amplify ?? []);

  const merged: EmotionRule[] = [];
  for (const rule of [...customRules, ...defaultRules]) {
    if (amplified.has(rule.reaction)) {
      merged.unshift(rule);
    } else {
      merged.push(rule);
    }
  }

  return merged;
}
