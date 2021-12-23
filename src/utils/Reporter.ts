import { TPlayerAnalyticsEvent } from "player-analytics-specification";

export interface IReporterOptions {
  eventsinkUrl: string;
  heartbeatInterval?: number;
  sessionId?: string;
  debug?: boolean;
}

export interface IReporterPostOptions {
  event: string;
  timestamp: number;
  playhead: number;
  duration: number;
}

export class Reporter {
  private debug: boolean;
  private eventsinkUrl: string;
  private sessionId?: string;
  private heartbeatInterval?: number;
  constructor(options: IReporterOptions) {
    this.debug = options.debug;
    this.eventsinkUrl = options.eventsinkUrl;
    this.sessionId = options.sessionId;
    this.heartbeatInterval = options.heartbeatInterval || 60_000;

    if (this.debug) {
      console.log("[AnalyticsReporter] Initiated AnalyticsReporter", options);
    }
  }

  public async init(
    sessionId?: string,
    payload?: any
  ): Promise<Record<string, any>> {
    this.sessionId = sessionId || this.sessionId;
    const data = {
      event: "init",
      sessionId: this.sessionId,
      timestamp: Date.now(),
      playhead: -1,
      duration: -1,
      payload,
    };
    if (this.debug) {
      console.log("[AnalyticsReporter] Init session:", data);
      return {
        sessionId: this.sessionId,
        heartbeatInterval: this.heartbeatInterval,
      };
    } else {
      const initResponse = await fetch(`${this.eventsinkUrl}`, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });
      if (!initResponse.ok) {
        throw new Error(
          `[AnalyticsReporter] init failed: ${initResponse.statusText}`
        );
      }
      const initResponseJson = await initResponse.json();
      if (!this.sessionId && !initResponseJson.sessionId) {
        throw new Error(`[AnalyticsReporter] init failed: no sessionId`);
      }
      if (!initResponseJson.heartbeatInterval) {
        throw new Error(
          `[AnalyticsReporter] init failed: heartbeatInterval not found in response`
        );
      }
      this.heartbeatInterval = initResponseJson.heartbeatInterval;
      this.sessionId = initResponseJson.sessionId;
      return {
        heartbeatInterval: this.heartbeatInterval,
        sessionId: this.sessionId,
      };
    }
  }

  public send(data: TPlayerAnalyticsEvent): void {
    const payload = {
      sessionId: this.sessionId,
      ...data,
    };
    if (this.debug) {
      console.log("[AnalyticsReporter] Send payload:", payload);
    } else {
      fetch(`${this.eventsinkUrl}`, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }
  }
}
