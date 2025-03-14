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
import { Reporter } from "./utils/Reporter";

export interface IPlayerAnalyticsInitOptions {
  sessionId?: string;
  heartbeatInterval?: number;
}

export class PlayerAnalytics implements PlayerAnalyticsClientModule {
  private debug = false;
  private eventsinkUrl: string;
  private analyticsReporter: Reporter;
  constructor(eventsinkUrl: string, debug?: boolean) {
    this.debug = debug;
    this.eventsinkUrl = eventsinkUrl;
  }

  public async initiateAnalyticsReporter({
    sessionId,
    heartbeatInterval = HEARTBEAT_INTERVAL,
  }: IPlayerAnalyticsInitOptions) {
    this.analyticsReporter = new Reporter({
      sessionId,
      eventsinkUrl: this.eventsinkUrl,
      debug: this.debug,
      heartbeatInterval,
    });

    const { sessionId: generatedSessionId, isInitiated } =
      await this.analyticsReporter.init(sessionId);

    return { sessionId: generatedSessionId, heartbeatInterval, isInitiated };
  }

  public init(data: TInitEvent): void {
    this.analyticsReporter.send(data);
  }

  public metadata(data: TMetadataEvent): void {
    this.analyticsReporter.send(data);
  }

  public heartbeat(data: THeartbeatEvent): void {
    this.analyticsReporter.send(data);
  }

  public loading(data: TLoadingEvent): void {
    this.analyticsReporter.send(data);
  }

  public loaded(data: TLoadedEvent): void {
    this.analyticsReporter.send(data);
  }

  public playing(data: TPlayingEvent): void {
    this.analyticsReporter.send(data);
  }

  public pause(data: TPausedEvent): void {
    this.analyticsReporter.send(data);
  }

  public buffering(data: TBufferingEvent): void {
    this.analyticsReporter.send(data);
  }

  public buffered(data: TBufferedEvent): void {
    this.analyticsReporter.send(data);
  }

  public seeking(data: TSeekingEvent): void {
    this.analyticsReporter.send(data);
  }

  public seeked(data: TSeekedEvent): void {
    this.analyticsReporter.send(data);
  }

  public bitrateChanged(data: TBitrateChangedEvent): void {
    this.analyticsReporter.send(data);
  }

  public error(data: TErrorEvent): void {
    this.analyticsReporter.send(data);
  }

  public warning(data: TWarningEvent): void {
    this.analyticsReporter.send(data);
  }

  public stopped(data: TStoppedEvent): void {
    this.analyticsReporter.send(data);
  }

  public destroy() {
    this.analyticsReporter = null;
  }
}
