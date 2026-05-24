import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";

export interface CuratedArticle {
  title: string;
  source: string;
  url: string;
  teaser: string;
  reason: string;
}

interface FeedSource {
  name: string;
  url: string;
}

interface CuratorHistory {
  urls: string[];
}

interface CuratorLast {
  timestamp: number;
}

const FEEDS: FeedSource[] = [
  { name: "NHK", url: "https://www.nhk.or.jp/rss/news/cat0.xml" },
  { name: "Hacker News", url: "https://hnrss.org/frontpage?count=10" },
  { name: "Zenn", url: "https://zenn.dev/feed" },
  { name: "はてなブックマーク", url: "https://b.hatena.ne.jp/hotentry/it.rss" },
  { name: "Publickey", url: "https://www.publickey1.jp/atom.xml" },
  { name: "Gigazine", url: "https://gigazine.net/news/rss_2.0/" },
];

const MAX_HISTORY = 200;
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface RawArticle {
  title: string;
  link: string;
  source: string;
  snippet: string;
}

export class NewsCurator {
  private stateDir: string;
  private historyPath: string;
  private lastPath: string;
  private apiKey?: string;

  constructor(stateDir: string, apiKey?: string) {
    this.stateDir = stateDir;
    this.historyPath = resolve(stateDir, "curator-history.json");
    this.lastPath = resolve(stateDir, "curator-last.json");
    this.apiKey = apiKey;
    try {
      mkdirSync(stateDir, { recursive: true });
    } catch {}
  }

  /**
   * Check if enough time has passed since last notification.
   */
  canNotify(): boolean {
    try {
      const raw = readFileSync(this.lastPath, "utf-8");
      const last = JSON.parse(raw) as CuratorLast;
      return Date.now() - last.timestamp >= MIN_INTERVAL_MS;
    } catch {
      // No last file = first run, allow
      return true;
    }
  }

  /**
   * Fetch articles from all RSS feeds, excluding already-notified URLs.
   */
  private async fetchAllArticles(): Promise<RawArticle[]> {
    const parser = new Parser();
    const history = this.loadHistory();
    const seenUrls = new Set(history.urls);
    const articles: RawArticle[] = [];

    const fetchPromises = FEEDS.map(async (feed) => {
      try {
        const result = await parser.parseURL(feed.url);
        const feedArticles: RawArticle[] = [];
        for (const item of result.items.slice(0, 10)) {
          const link = item.link ?? "";
          if (!link || seenUrls.has(link)) continue;
          feedArticles.push({
            title: item.title ?? "(untitled)",
            link,
            source: feed.name,
            snippet: (item.contentSnippet ?? item.content ?? "").slice(0, 200),
          });
        }
        return feedArticles;
      } catch {
        return [];
      }
    });

    const results = await Promise.all(fetchPromises);
    for (const batch of results) {
      articles.push(...batch);
    }

    return articles;
  }

  /**
   * Use Claude Haiku to pick the single most notable article for an engineer.
   */
  private async pickWithAI(articles: RawArticle[]): Promise<CuratedArticle | null> {
    if (articles.length === 0) return null;

    const listing = articles
      .map((a, i) => `[${i}] 【${a.source}】 ${a.title}\n    ${a.snippet}`)
      .join("\n\n");

    const client = new Anthropic({ apiKey: this.apiKey });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `あなたはエンジニア向けニュースキュレーターです。以下の記事一覧から、ソフトウェアエンジニアにとって最も注目すべき1本を選んでください。

記事一覧:
${listing}

以下のJSON形式で回答してください。他のテキストは不要です。
{"index": 選んだ記事の番号, "reason": "なぜ注目すべきか（1-2文）", "teaser": "この記事を紹介する一言（1-2文、綾波レイ風に簡潔に）"}`,
        },
      ],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "";

    try {
      // Extract JSON from response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as {
        index: number;
        reason: string;
        teaser: string;
      };

      const chosen = articles[parsed.index];
      if (!chosen) return null;

      return {
        title: chosen.title,
        source: chosen.source,
        url: chosen.link,
        teaser: parsed.teaser,
        reason: parsed.reason,
      };
    } catch {
      return null;
    }
  }

  /**
   * Main entry: curate one article. Returns null if throttled or no new articles.
   * @param options.force - If true, bypass the frequency throttle check.
   */
  async curate(options?: { force?: boolean }): Promise<CuratedArticle | null> {
    if (!options?.force && !this.canNotify()) return null;

    const articles = await this.fetchAllArticles();
    if (articles.length === 0) return null;

    const picked = await this.pickWithAI(articles);
    if (!picked) return null;

    // Record this URL in history
    this.addToHistory(picked.url);

    // Update last notification timestamp
    this.saveLastTimestamp();

    return picked;
  }

  private loadHistory(): CuratorHistory {
    try {
      const raw = readFileSync(this.historyPath, "utf-8");
      return JSON.parse(raw) as CuratorHistory;
    } catch {
      return { urls: [] };
    }
  }

  private addToHistory(url: string): void {
    const history = this.loadHistory();
    history.urls.push(url);
    // Keep only the latest MAX_HISTORY entries
    if (history.urls.length > MAX_HISTORY) {
      history.urls = history.urls.slice(history.urls.length - MAX_HISTORY);
    }
    writeFileSync(this.historyPath, JSON.stringify(history, null, 2), "utf-8");
  }

  private saveLastTimestamp(): void {
    const data: CuratorLast = { timestamp: Date.now() };
    writeFileSync(this.lastPath, JSON.stringify(data), "utf-8");
  }
}
