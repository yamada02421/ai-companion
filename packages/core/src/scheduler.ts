export type NotifyType = "greeting" | "weather" | "news";

export interface ScheduledEvent {
  type: NotifyType;
  intervalMs: number;
  lastRun: number;
}

export class Scheduler {
  private events: ScheduledEvent[] = [];
  private callback: ((type: NotifyType) => Promise<void>) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  addEvent(type: NotifyType, intervalMinutes: number): void {
    this.events.push({
      type,
      intervalMs: intervalMinutes * 60 * 1000,
      lastRun: 0,
    });
  }

  onNotify(cb: (type: NotifyType) => Promise<void>): void {
    this.callback = cb;
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), 30_000);
    this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const event of this.events) {
      if (now - event.lastRun >= event.intervalMs) {
        event.lastRun = now;
        if (this.callback) {
          await this.callback(event.type).catch(() => {});
        }
      }
    }
  }
}
