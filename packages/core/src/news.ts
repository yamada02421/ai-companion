import Parser from "rss-parser";

export interface NewsItem {
  title: string;
  link: string;
  pubDate?: string;
}

const DEFAULT_FEEDS = [
  "https://www.nhk.or.jp/rss/news/cat0.xml",
];

export async function fetchNews(
  feeds: string[] = DEFAULT_FEEDS,
  limit: number = 5
): Promise<NewsItem[]> {
  const parser = new Parser();
  const items: NewsItem[] = [];

  for (const feedUrl of feeds) {
    try {
      const feed = await parser.parseURL(feedUrl);
      for (const item of feed.items.slice(0, limit)) {
        items.push({
          title: item.title ?? "(無題)",
          link: item.link ?? "",
          pubDate: item.pubDate,
        });
      }
    } catch {
      // skip failed feeds
    }
  }

  return items.slice(0, limit);
}

export function formatNewsContext(items: NewsItem[]): string {
  if (items.length === 0) return "最新のニュースは取得できませんでした。";

  const headlines = items
    .map((item, i) => `${i + 1}. ${item.title}`)
    .join("\n");

  return `最新のニュースヘッドライン:\n${headlines}\n\nこの中から1〜2件を選んで、キャラクターとして短くコメントしてください。`;
}
