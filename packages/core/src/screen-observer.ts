import Anthropic from "@anthropic-ai/sdk";

export class ScreenObserver {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * スクリーンショットを分析して、ユーザーの状況を短く説明
   * Claude Haiku の Vision 機能を使用
   */
  async observe(screenshotBase64: string): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshotBase64,
              },
            },
            {
              type: "text",
              text: "この画面のスクリーンショットを見て、ユーザーが何をしているか1-2文で簡潔に説明してください。プライバシーに配慮し、パスワードや個人情報には触れないでください。",
            },
          ],
        },
      ],
    });

    const block = response.content[0];
    return block.type === "text" ? block.text : "";
  }
}
