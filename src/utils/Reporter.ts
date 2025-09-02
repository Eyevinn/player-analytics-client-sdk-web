import {
  TInitEvent,
  TPlayerAnalyticsEvent,
} from "@eyevinn/player-analytics-specification";
import { EPAS_VERSION, HEARTBEAT_INTERVAL } from "./constants";

export interface IReporterOptions {
  eventsinkUrl: string;
  heartbeatInterval?: number;
  sessionId?: string;
  shardId?: string;
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
  private shardId?: string;
  private heartbeatInterval?: number;
  private isInitiated = false;

  constructor(options: IReporterOptions) {
    this.debug = options.debug;
    this.shardId = options.shardId;
    this.eventsinkUrl = options.eventsinkUrl;
    this.sessionId = options.sessionId;
    this.heartbeatInterval = options.heartbeatInterval || HEARTBEAT_INTERVAL;

    if (this.debug) {
      console.log("[AnalyticsReporter] Initiated AnalyticsReporter", options);
    }
  }

  public async init(sessionId?: string): Promise<Record<string, any>> {
    this.sessionId = sessionId || this.sessionId;
    const data: TInitEvent = {
      event: "init",
      sessionId: this.sessionId,
      shardId: this.shardId,
      timestamp: Date.now(),
      playhead: -1,
      duration: -1,
    };
    if (this.debug) {
      console.log("[AnalyticsReporter] Init session:", data);
      this.isInitiated = true;
      return {
        sessionId: this.sessionId,
        heartbeatInterval: this.heartbeatInterval,
        isInitiated: this.isInitiated,
      };
    } else {
      const initResponse = await fetch(`${this.eventsinkUrl}`, {
        method: "POST",
        mode: "cors",
        cache: "no-cache",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-EPAS-Event": data.event,
          "X-EPAS-Version": EPAS_VERSION,
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
      if (initResponseJson.sessionId) {
        this.sessionId = initResponseJson.sessionId;
      }
      this.isInitiated = true;
      return {
        heartbeatInterval: this.heartbeatInterval,
        sessionId: this.sessionId,
        isInitiated: this.isInitiated,
      };
    }
  }

  public send(data: TPlayerAnalyticsEvent): void {
    if (!this.isInitiated)
      return console.warn(
        "[AnalyticsReporter] Cannot report before initiation:",
        data
      );
    const payload = {
      sessionId: this.sessionId,
      shardId: this.shardId,
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
          "Content-Type": "application/json; charset=utf-8",
          "X-EPAS-Event": data.event,
          "X-EPAS-Version": EPAS_VERSION,
        },
        body: JSON.stringify(payload),
      });
    }
  }
}
