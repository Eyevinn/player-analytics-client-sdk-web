import {
  TInitEvent,
  TPlayerAnalyticsEvent,
} from "@eyevinn/player-analytics-specification";
import { EPAS_VERSION, HEARTBEAT_INTERVAL } from "./constants";

export type TAnalyticsSendError = {
  status?: number;
  statusText?: string;
  message: string;
};

export type TOnSendError = (
  error: TAnalyticsSendError,
  event: TPlayerAnalyticsEvent
) => void;

type ReporterState = "idle" | "initializing" | "ready" | "failed";

const MAX_QUEUE_SIZE = 100;

export interface IReporterOptions {
  eventsinkUrl: string;
  heartbeatInterval?: number;
  sessionId?: string;
  shardId?: string;
  debug?: boolean;
  onError?: TOnSendError;
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
  private state: ReporterState = "idle";
  private eventQueue: TPlayerAnalyticsEvent[] = [];
  private initPromise: Promise<Record<string, unknown>> | null = null;
  private onError?: TOnSendError;

  constructor(options: IReporterOptions) {
    this.debug = options.debug ?? false;
    this.shardId = options.shardId;
    this.eventsinkUrl = options.eventsinkUrl;
    this.sessionId = options.sessionId;
    this.heartbeatInterval = options.heartbeatInterval || HEARTBEAT_INTERVAL;
    this.onError = options.onError;

    if (this.debug) {
      console.log("[AnalyticsReporter] Initiated AnalyticsReporter", options);
    }
  }

  public get isInitiated(): boolean {
    return this.state === "ready";
  }

  public async init(sessionId?: string): Promise<Record<string, unknown>> {
    if (this.state !== "idle") {
      return this.initPromise!;
    }

    this.sessionId = sessionId || this.sessionId;
    this.state = "initializing";

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
      this.state = "ready";
      this.flushQueue();
      const result = {
        sessionId: this.sessionId,
        heartbeatInterval: this.heartbeatInterval,
        isInitiated: true,
      };
      this.initPromise = Promise.resolve(result);
      return this.initPromise;
    }

    this.initPromise = this.doInit(data);
    return this.initPromise;
  }

  private async doInit(data: TInitEvent): Promise<Record<string, unknown>> {
    try {
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

      this.state = "ready";
      this.flushQueue();

      return {
        heartbeatInterval: this.heartbeatInterval,
        sessionId: this.sessionId,
        isInitiated: true,
      };
    } catch (err) {
      this.state = "failed";
      this.eventQueue = [];
      throw err;
    }
  }

  public send(data: TPlayerAnalyticsEvent): void {
    switch (this.state) {
      case "ready":
        this.dispatch(data);
        break;
      case "initializing":
        if (this.eventQueue.length >= MAX_QUEUE_SIZE) {
          console.warn("[AnalyticsReporter] Event queue full, dropping newest event");
          break;
        }
        this.eventQueue.push(data);
        break;
      case "idle":
        console.warn(
          "[AnalyticsReporter] Cannot report before initiation:",
          data
        );
        break;
      case "failed":
        console.warn(
          "[AnalyticsReporter] Init failed, cannot send:",
          data
        );
        break;
    }
  }

  private dispatch(data: TPlayerAnalyticsEvent): Promise<void> {
    const payload = {
      ...data,
      sessionId: this.sessionId,
      shardId: this.shardId,
    };
    if (this.debug) {
      console.log("[AnalyticsReporter] Send payload:", payload);
      return Promise.resolve();
    }
    return fetch(`${this.eventsinkUrl}`, {
      method: "POST",
      mode: "cors",
      cache: "no-cache",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-EPAS-Event": data.event,
        "X-EPAS-Version": EPAS_VERSION,
      },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (res && !res.ok) {
        const error: TAnalyticsSendError = {
          status: res.status,
          statusText: res.statusText,
          message: `Send failed: ${res.status} ${res.statusText}`,
        };
        if (this.onError) {
          this.onError(error, data);
        } else {
          console.warn(`[AnalyticsReporter] ${error.message}`);
        }
      }
    }).catch((err) => {
      const error: TAnalyticsSendError = {
        message: err instanceof Error ? err.message : String(err),
      };
      if (this.onError) {
        this.onError(error, data);
      } else {
        console.warn("[AnalyticsReporter] Send failed:", error.message);
      }
    });
  }

  private flushQueue(): void {
    const queued = this.eventQueue;
    this.eventQueue = [];
    // Serialize sends to preserve event order on the wire
    let chain = Promise.resolve();
    for (const event of queued) {
      chain = chain.then(() => this.dispatch(event));
    }
  }
}
