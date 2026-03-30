import {
  PlayerAnalyticsClientModule,
  TBitrateChangedEvent,
  TBufferedEvent,
  TBufferingEvent,
  TErrorEvent,
  THeartbeatEvent,
  TInitEvent,
  TLoadedEvent,
  TLoadingEvent,
  TMetadataEvent,
  TPausedEvent,
  TPlayingEvent,
  TSeekedEvent,
  TSeekingEvent,
  TStoppedEvent,
  TWarningEvent,
} from "@eyevinn/player-analytics-specification";
import { HEARTBEAT_INTERVAL } from "./utils/constants";
import { Reporter, TOnSendError } from "./utils/Reporter";

export interface IPlayerAnalyticsInitOptions {
  sessionId?: string;
  shardId?: string;
  heartbeatInterval?: number;
}

export class PlayerAnalytics implements PlayerAnalyticsClientModule {
  private debug = false;
  private eventsinkUrl: string;
  private analyticsReporter: Reporter;
  private onError?: TOnSendError;
  constructor(eventsinkUrl: string, debug?: boolean, onError?: TOnSendError) {
    this.debug = debug ?? false;
    this.eventsinkUrl = eventsinkUrl;
    this.onError = onError;
  }

  public async initiateAnalyticsReporter({
    sessionId,
    shardId,
    heartbeatInterval = HEARTBEAT_INTERVAL,
  }: IPlayerAnalyticsInitOptions) {
    this.analyticsReporter = new Reporter({
      sessionId,
      eventsinkUrl: this.eventsinkUrl,
      debug: this.debug,
      heartbeatInterval,
      shardId,
      onError: this.onError,
    });

    const { sessionId: generatedSessionId, isInitiated } =
      await this.analyticsReporter.init(sessionId);

    return { sessionId: generatedSessionId, heartbeatInterval, isInitiated };
  }

  private ensureReporter(): boolean {
    if (!this.analyticsReporter) {
      console.warn('[PlayerAnalytics] Not initialized. Call initiateAnalyticsReporter() first.');
      return false;
    }
    return true;
  }

  public init(data: TInitEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public metadata(data: TMetadataEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public heartbeat(data: THeartbeatEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public loading(data: TLoadingEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public loaded(data: TLoadedEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public playing(data: TPlayingEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public pause(data: TPausedEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public buffering(data: TBufferingEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public buffered(data: TBufferedEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public seeking(data: TSeekingEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public seeked(data: TSeekedEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public bitrateChanged(data: TBitrateChangedEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public error(data: TErrorEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public warning(data: TWarningEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public stopped(data: TStoppedEvent): void {
    if (!this.ensureReporter()) return;
    this.analyticsReporter.send(data);
  }

  public destroy() {
    this.analyticsReporter = null;
  }
}
