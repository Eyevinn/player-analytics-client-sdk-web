import {
  getMediaEventFilter,
  FilteredMediaEvent,
  TMediaEventFilter,
} from "@eyevinn/media-event-filter";
import { EPASEvents } from "./utils/constants";
import { PlayerAnalytics } from "./PlayerAnalytics";
import {
  TBaseEvent,
  TBitrateChangedEventPayload,
  TErrorEventPayload,
  TMetadataEventPayload,
  UUID,
} from "@eyevinn/player-analytics-specification";

export interface IPlayerAnalyticsConnectorInitOptions {
  sessionId?: string;
  heartbeatInterval?: number;
}

export class PlayerAnalyticsConnector {
  private eventsinkUrl: string;
  private sessionId: UUID;
  private player: HTMLVideoElement;

  private playerAnalytics: PlayerAnalytics;
  private analyticsInitiated = false;

  private videoEventFilter: TMediaEventFilter;
  private videoEventListener: any;

  private heartbeatInterval: number;
  private heartbeatIntervalTimer: ReturnType<typeof setInterval>;

  constructor(eventsinkUrl: string, debug?: boolean) {
    this.eventsinkUrl = eventsinkUrl;
    this.playerAnalytics = new PlayerAnalytics(this.eventsinkUrl, debug);
  }

  public async init(options: IPlayerAnalyticsConnectorInitOptions) {
    this.sessionId = options.sessionId;
    const { heartbeatInterval, isInitiated } =
      await this.playerAnalytics.initiateAnalyticsReporter({
        sessionId: this.sessionId,
        ...options,
      });

    this.analyticsInitiated = isInitiated;
    this.heartbeatInterval = heartbeatInterval;
  }

  public load(player: HTMLVideoElement) {
    this.player = player;
    this.playerAnalytics.loading({
      event: EPASEvents.loading,
      ...this.playbackState(),
    });
    this.initiateVideoEventFilter();
  }

  private initiateVideoEventFilter() {
    if (!this.player) return;
    this.videoEventFilter = getMediaEventFilter({
      mediaElement: this.player,
      mp4Mode: false,
      callback: (event: FilteredMediaEvent) => {
        let eventType;
        const extraData = {};
        switch (event) {
          case FilteredMediaEvent.LOADED:
            eventType = EPASEvents.loaded;
            break;
          case FilteredMediaEvent.PLAY:
            eventType = EPASEvents.play;
            this.startInterval();
            break;
          case FilteredMediaEvent.PLAYING:
            eventType = EPASEvents.resume;
            break;
          case FilteredMediaEvent.PAUSE:
            eventType = EPASEvents.pause;
            break;
          case FilteredMediaEvent.SEEKING:
            eventType = EPASEvents.seeking;
            break;
          case FilteredMediaEvent.SEEKED:
            eventType = EPASEvents.seeked;
            break;
          case FilteredMediaEvent.BUFFERING:
            eventType = EPASEvents.buffering;
            break;
          case FilteredMediaEvent.BUFFERED:
            eventType = EPASEvents.buffered;
            break;
          case FilteredMediaEvent.ENDED:
            eventType = EPASEvents.ended;
            (extraData as any).reason = "ended";
            this.stopInterval();
            break;
          default:
            break;
        }
        if (!this.analyticsInitiated) {
          console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
          return;
        }
        this.playerAnalytics[eventType]({
          event: eventType,
          ...this.playbackState(),
          ...(Object.keys(extraData).length > 0 && { payload: extraData }),
        });
      },
    });
  }

  private startInterval() {
    if (this.heartbeatIntervalTimer) return;
    this.heartbeatIntervalTimer = setInterval(() => {
      this.playerAnalytics.heartbeat({
        event: EPASEvents.heartbeat,
        ...this.playbackState(),
      });
    }, this.heartbeatInterval);
  }

  private stopInterval() {
    clearInterval(this.heartbeatIntervalTimer);
  }

  public reportBitrateChange(payload: TBitrateChangedEventPayload) {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.bitrateChanged({
      event: EPASEvents.bitratechanged,
      ...this.playbackState(),
      payload,
    });
  }

  public reportStop() {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.stopped({
      event: EPASEvents.ended,
      ...this.playbackState(),
      payload: { reason: "aborted" },
    });
    this.stopInterval();
  }

  public reportError(error: TErrorEventPayload) {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.error({
      event: EPASEvents.error,
      ...this.playbackState(),
      payload: error,
    });
    this.playerAnalytics.stopped({
      event: EPASEvents.ended,
      ...this.playbackState(),
      payload: { reason: "error" },
    });
    this.stopInterval();
  }

  public reportMetadata(payload: TMetadataEventPayload) {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.metadata({
      event: EPASEvents.metadata,
      ...this.playbackState(),
      payload,
    });
  }

  public reportWarning(payload: TErrorEventPayload) {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.warning({
      event: EPASEvents.warning,
      ...this.playbackState(),
      payload,
    });
  }

  private playbackState(): TBaseEvent {
    const duration =
      this.player?.duration &&
      this.player?.duration !== Infinity &&
      this.player?.duration > 0
        ? this.player.duration
        : -1;
    const playhead =
      this.player?.currentTime && duration !== -1
        ? this.player?.currentTime
        : -1;
    return {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      playhead,
      duration,
    };
  }

  public deinit() {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.stopInterval();
    this.heartbeatInterval = null;
    this.videoEventFilter && this.videoEventFilter.teardown();
    this.videoEventFilter = null;
  }

  public destroy() {
    if (!this.analyticsInitiated) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.destroy();
    this.heartbeatInterval = null;
    this.videoEventFilter && this.videoEventFilter.teardown();
    this.stopInterval();
  }
}
