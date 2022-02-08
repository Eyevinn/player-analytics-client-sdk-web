import { VideoEventFilter, PlayerEvents } from "@eyevinn/video-event-filter";
import { EPASEvents } from "./utils/constants";
import { PlayerAnalytics } from "./PlayerAnalytics";
import {
  TBaseEvent,
  TBitrateChangedEventPayload,
  TErrorEventPayload,
  UUID,
} from "@eyevinn/player-analytics-specification";

export interface IPlayerAnalyticsConnectorInitOptions {
  sessionId?: string;
  live: boolean;
  contentId: string;
  contentUrl: string;
  drmType?: string;
  userId?: string;
  deviceId?: string;
  deviceModel?: string;
  deviceType?: string;

  heartbeatInterval?: number;
}

export interface IBitrateChangedPayload {
  bitrate: ""; // bitrate in Kbps
  width?: ""; // video width in pixels
  height?: ""; // video height in pixels
  videoBitrate?: ""; // if available provide the bitrate for the video track
  audioBitrate?: ""; // if available provide the bitrate for the audio track
}

export interface IErrorPayload {
  category?: ""; // eg. NETWORK, DECODER, etc.
  code: "";
  message?: "";
  data?: {};
}

export class PlayerAnalyticsConnector {
  private eventsinkUrl: string;
  private sessionId: UUID;
  private player: HTMLVideoElement;

  private playerAnalytics: PlayerAnalytics;

  private videoEventFilter: VideoEventFilter;
  private videoEventListener: any;

  private heartbeatInterval: number;
  private heartbeatIntervalTimer: ReturnType<typeof setInterval>;

  constructor(eventsinkUrl: string, debug?: boolean) {
    this.eventsinkUrl = eventsinkUrl;

    this.playerAnalytics = new PlayerAnalytics(this.eventsinkUrl, debug);
  }

  public async init(options: IPlayerAnalyticsConnectorInitOptions) {
    this.sessionId = options.sessionId;
    const { heartbeatInterval } =
      await this.playerAnalytics.initiateAnalyticsReporter({
        sessionId: this.sessionId,
        ...options,
      });
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
    this.videoEventFilter = new VideoEventFilter(this.player);
    this.videoEventFilter.addEventListener(
      "*",
      (this.videoEventListener = (event: PlayerEvents) => {
        if (!Object.keys(EPASEvents).includes(event)) return;
        let eventType;
        const extraData = {};
        if (!event) return;
        switch (event) {
          case PlayerEvents.Loaded:
            eventType = EPASEvents.loaded;
            break;
          case PlayerEvents.Loading:
            eventType = EPASEvents.loading;
            break;
          case PlayerEvents.Play:
          case PlayerEvents.Resume:
            eventType = EPASEvents.play;
            this.startInterval();
            break;
          case PlayerEvents.Pause:
            eventType = EPASEvents.pause;
            break;
          case PlayerEvents.Seeking:
            eventType = EPASEvents.seeking;
            break;
          case PlayerEvents.Seeked:
            eventType = EPASEvents.seeked;
            break;
          case PlayerEvents.Buffering:
            eventType = EPASEvents.buffering;
            break;
          case PlayerEvents.Buffered:
            eventType = EPASEvents.buffered;
            break;
          case PlayerEvents.Ended:
            eventType = EPASEvents.ended;
            (extraData as any).reason = "ended";
            this.stopInterval();
            break;
          case PlayerEvents.Error:
            eventType = EPASEvents.error;
            (extraData as any).reason = "error";
            this.stopInterval();
            break;
          default:
            break;
        }
        this.playerAnalytics[eventType]({
          event: eventType,
          ...this.playbackState(),
          ...(Object.keys(extraData).length > 0 && { payload: extraData }),
        });
      })
    );
  }

  private startInterval() {
    if (this.heartbeatIntervalTimer) return;
    this.heartbeatIntervalTimer = setInterval(() => {
      this.playerAnalytics.heartbeat({
        event: "heartbeat",
        ...this.playbackState(),
      });
    }, this.heartbeatInterval);
  }

  private stopInterval() {
    clearInterval(this.heartbeatIntervalTimer);
  }

  public reportBitrateChange(payload: TBitrateChangedEventPayload) {
    this.playerAnalytics.bitrateChanged({
      event: EPASEvents.bitratechanged,
      ...this.playbackState(),
      payload,
    });
  }

  public reportStop() {
    this.playerAnalytics.stopped({
      event: EPASEvents.ended,
      ...this.playbackState(),
      payload: { reason: "aborted" },
    });
    this.stopInterval();
  }

  public reportError(error: TErrorEventPayload) {
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

  public reportWarning(payload: TErrorEventPayload) {
    this.playerAnalytics.warning({
      event: EPASEvents.warning,
      ...this.playbackState(),
      payload,
    });
  }

  private playbackState(): TBaseEvent {
    const playhead =
      !this.player.currentTime && this.player.currentTime !== 0
        ? -1
        : this.player.currentTime || 0;
    const duration =
      !this.player.duration && this.player.duration !== 0
        ? -1
        : this.player.duration || 0;
    return {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      playhead,
      duration,
    };
  }

  public destroy() {
    this.playerAnalytics.destroy();
    this.heartbeatInterval = null;
    this.videoEventFilter.removeEventListener("*", this.videoEventListener);
    this.stopInterval();
  }
}
