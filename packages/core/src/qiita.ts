export interface QiitaItem {
  title: string;
  url: string;
  likes_count: number;
  tags: string[];
}

export async function fetchQiitaTrending(limit: number = 5): Promise<QiitaItem[]> {
  const since = new Date();
  since.setDate(since.getDate() - 3);
  const sinceStr = since.toISOString().split("T")[0];

  const url = `https://qiita.com/api/v2/items?page=1&per_page=${limit}&query=created:>=${sinceStr}+stocks:>=10`;
  const res = await fetch(url, {
    headers: { "User-Agent": "ai-companion/0.1" },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as Array<{
    title: string;
    url: string;
    likes_count: number;
    tags: Array<{ name: string }>;
  }>;

  return data.map((item) => ({
    title: item.title,
    url: item.url,
    likes_count: item.likes_count,
    tags: item.tags.map((t) => t.name),
  }));
}

export function formatQiitaContext(items: QiitaItem[]): string {
  if (items.length === 0) return "";

  const list = items
    .map((item, i) => `${i + 1}. ${item.title} (${item.tags.slice(0, 3).join(", ")}) [♡${item.likes_count}]`)
    .join("\n");

  return `最近注目されているQiita記事:\n${list}\n\nこの中から1〜2件選んで、エンジニアとして注目すべきポイントを短くコメントしてください。`;
}
