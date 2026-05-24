import { exec } from "child_process";
import { readFileSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const CLEANUP_AGE_MS = 5 * 60 * 1000; // 5分

export class ScreenCapture {
  /**
   * スクリーンショットを撮ってBase64文字列を返す
   * PowerShell の System.Drawing を使用
   */
  async capture(): Promise<string> {
    const tmpDir = resolve(
      process.env.TEMP ?? process.env.TMP ?? ".",
      "ai-companion-screenshots",
    );
    const filePath = await this.captureToFile(tmpDir);
    const buffer = readFileSync(filePath);

    // 使い終わったファイルは即削除
    try {
      unlinkSync(filePath);
    } catch {}

    return buffer.toString("base64");
  }

  /**
   * スクリーンショットを撮ってファイルに保存
   */
  async captureToFile(outputDir: string): Promise<string> {
    try {
      mkdirSync(outputDir, { recursive: true });
    } catch {}

    // 古いスクリーンショットを自動削除
    this.cleanupOld(outputDir);

    const filename = `screenshot-${Date.now()}.png`;
    const outputPath = resolve(outputDir, filename);

    // PowerShell でスクリーンショットを撮る
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$bitmap.Save('${outputPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`.trim();

    await execAsync(`powershell -NoProfile -Command "${psScript}"`, {
      timeout: 15000,
    });

    return outputPath;
  }

  /**
   * 古いスクリーンショットファイルを削除（5分以上前）
   */
  private cleanupOld(dir: string): void {
    try {
      const now = Date.now();
      const files = readdirSync(dir);
      for (const file of files) {
        if (!file.startsWith("screenshot-") || !file.endsWith(".png")) continue;
        // ファイル名からタイムスタンプを抽出
        const match = file.match(/^screenshot-(\d+)\.png$/);
        if (!match) continue;
        const fileTime = parseInt(match[1], 10);
        if (now - fileTime > CLEANUP_AGE_MS) {
          try {
            unlinkSync(join(dir, file));
          } catch {}
        }
      }
    } catch {}
  }
}
