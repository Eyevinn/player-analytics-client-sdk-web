import {
  getMediaEventFilter,
  FilteredMediaEvent,
  TMediaEventFilter,
} from "@eyevinn/media-event-filter";
import { PlayerAnalytics } from "./PlayerAnalytics";
import { TOnSendError } from "./utils/Reporter";
import {
  TBaseEvent,
  TBitrateChangedEventPayload,
  TErrorEventPayload,
  TEventType,
  TMetadataEventPayload,
  TWarningEventPayload,
  UUID,
} from "@eyevinn/player-analytics-specification";

export interface IPlayerAnalyticsConnectorInitOptions {
  sessionId?: string;
  heartbeatInterval?: number;
  shardId?: string;
}

export class PlayerAnalyticsConnector {
  private eventsinkUrl: string;
  private sessionId: UUID;
  private player: HTMLVideoElement;

  private playerAnalytics: PlayerAnalytics;
  private analyticsInitiated = false;
  private initCalled = false;
  private initGeneration = 0;

  private videoEventFilter: TMediaEventFilter;
  private videoEventListener: unknown;

  // Direct DOM fallback for terminal/seek events on an element that was already
  // playing when load() ran (autoplay started during a slow init() handshake).
  // The media-event-filter attaches in its "loading" state and, never having
  // observed the initial playing/canplaythrough transitions, stays stuck there
  // and suppresses ENDED/SEEKING/SEEKED. These listeners drive that path
  // directly. They self-disable the moment the filter proves it is live (emits
  // any event), so a seek is never reported twice across the two sources.
  private autoplayFallbackActive = false;

  private heartbeatInterval: number;
  private heartbeatIntervalTimer: ReturnType<typeof setInterval>;
  private pendingHeartbeatStart = false;

  // Tracks whether a stopped event has already been reported for the current
  // session, so the page-unload path does not emit a duplicate after an
  // `ended`, reportStop(), or reportError() has already stopped the session.
  private stoppedReported = false;
  private unloadListenersRegistered = false;

  constructor(eventsinkUrl: string, debug?: boolean, onError?: TOnSendError) {
    this.eventsinkUrl = eventsinkUrl;
    this.playerAnalytics = new PlayerAnalytics(
      this.eventsinkUrl,
      debug,
      onError
    );
  }

  public async init(options: IPlayerAnalyticsConnectorInitOptions) {
    this.sessionId = options.sessionId;
    this.initCalled = true;
    this.stoppedReported = false;
    const currentGeneration = ++this.initGeneration;

    const initPromise = this.playerAnalytics.initiateAnalyticsReporter({
      ...options,
      sessionId: this.sessionId,
    });

    initPromise
      .then((result) => {
        // Ignore stale init completions (e.g., if destroy() was called during init)
        if (currentGeneration !== this.initGeneration) return;

        this.analyticsInitiated = result.isInitiated === true;
        this.heartbeatInterval =
          Number(result.heartbeatInterval) || this.heartbeatInterval;
        if (typeof result.sessionId === "string" && result.sessionId) {
          this.sessionId = result.sessionId;
        }
        if (this.pendingHeartbeatStart) {
          this.pendingHeartbeatStart = false;
          this.startInterval();
        }
      })
      .catch((err: unknown) => {
        if (currentGeneration !== this.initGeneration) return;
        // Reset pendingHeartbeatStart so a retry doesn't fire heartbeats
        // from a stale flag without a new PLAYING event.
        this.pendingHeartbeatStart = false;
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[PlayerAnalyticsConnector] Init failed:", message);
      });

    return initPromise;
  }

  public load(player: HTMLVideoElement) {
    this.player = player;
    this.playerAnalytics.loading({
      event: "loading",
      ...this.playbackState(),
    });
    this.initiateVideoEventFilter();
    this.registerUnloadListeners();

    // If the element is already playing by the time load() is called (e.g.
    // autoplay started during a slow init() handshake, before listeners were
    // attached), the media-event-filter won't emit a fresh PLAYING for the
    // DOM "playing" event that already fired. Emit it ourselves and start the
    // heartbeat so the session isn't lost. While init() is still in-flight the
    // event is queued by the Reporter and the heartbeat start is deferred via
    // pendingHeartbeatStart, flushing once the handshake completes.
    if (this.isPlayerAlreadyPlaying()) {
      this.playerAnalytics.playing({
        event: "playing",
        ...this.playbackState(),
      });
      this.startInterval();
      // The filter won't emit terminal/seek events for this already-playing
      // element (see isPlayerAlreadyPlaying / initiateVideoEventFilter notes),
      // so drive ended/seeking/seeked from the element's own DOM events.
      this.attachAutoplayTerminalFallback();
    }
  }

  private isPlayerAlreadyPlaying(): boolean {
    // HAVE_FUTURE_DATA (readyState 3) mirrors the media-event-filter's own
    // "ready" threshold. Use the numeric literal rather than
    // HTMLMediaElement.HAVE_FUTURE_DATA so this works in non-DOM test envs.
    return !!(
      this.player &&
      !this.player.paused &&
      !this.player.ended &&
      this.player.readyState >= 3
    );
  }

  private initiateVideoEventFilter() {
    if (!this.player) return;
    this.videoEventFilter = getMediaEventFilter({
      mediaElement: this.player,
      mp4Mode: false,
      callback: (event: FilteredMediaEvent) => {
        // The filter emitting anything means it has left its initial "loading"
        // state and is now the authoritative source for terminal/seek events;
        // retire the autoplay DOM fallback so a single seek/ended is not
        // reported twice.
        this.detachAutoplayTerminalFallback();

        let eventType: TEventType;
        const extraData = {};
        switch (event) {
          case FilteredMediaEvent.LOADED:
            eventType = "loaded";
            break;
          case FilteredMediaEvent.PLAYING:
            eventType = "playing";
            this.startInterval();
            break;
          case FilteredMediaEvent.PAUSE:
            eventType = "paused";
            break;
          case FilteredMediaEvent.SEEKING:
            eventType = "seeking";
            break;
          case FilteredMediaEvent.SEEKED:
            eventType = "seeked";
            break;
          case FilteredMediaEvent.BUFFERING:
            eventType = "buffering";
            break;
          case FilteredMediaEvent.BUFFERED:
            eventType = "buffered";
            break;
          case FilteredMediaEvent.ENDED:
            // Guard against a duplicate stopped(ended) if the autoplay fallback
            // (or reportStop/reportError) already ended the session.
            if (this.stoppedReported) return;
            eventType = "stopped";
            extraData["reason"] = "ended";
            this.stoppedReported = true;
            this.stopInterval();
            break;
          default:
            break;
        }
        this.sendFilteredEvent(eventType, extraData);
      },
    });
  }

  // Shared emit path for events sourced from the media-event-filter and from
  // the autoplay DOM fallback, so both behave identically (init guard, the
  // paused→pause method-name mapping, optional payload, error swallowing).
  private sendFilteredEvent(
    eventType: TEventType,
    extraData: Record<string, unknown> = {}
  ) {
    try {
      if (!this.initCalled) {
        console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
        return;
      }
      if (eventType) {
        this.playerAnalytics[eventType == "paused" ? "pause" : eventType]({
          event: eventType,
          ...this.playbackState(),
          ...(Object.keys(extraData).length > 0 && { payload: extraData }),
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  private handleAutoplayEnded = () => {
    // Mirror the filter's ENDED branch: exactly one stopped(ended), stop
    // heartbeats, and respect the stoppedReported guard so reportStop/
    // reportError/unload can't produce a duplicate.
    if (this.stoppedReported) return;
    this.stoppedReported = true;
    this.stopInterval();
    this.sendFilteredEvent("stopped", { reason: "ended" });
  };

  private handleAutoplaySeeking = () => {
    this.sendFilteredEvent("seeking");
  };

  private handleAutoplaySeeked = () => {
    this.sendFilteredEvent("seeked");
  };

  private attachAutoplayTerminalFallback() {
    if (this.autoplayFallbackActive) return;
    if (!this.player || typeof this.player.addEventListener !== "function") {
      return;
    }
    this.autoplayFallbackActive = true;
    this.player.addEventListener("ended", this.handleAutoplayEnded);
    this.player.addEventListener("seeking", this.handleAutoplaySeeking);
    this.player.addEventListener("seeked", this.handleAutoplaySeeked);
  }

  private detachAutoplayTerminalFallback() {
    if (!this.autoplayFallbackActive) return;
    this.autoplayFallbackActive = false;
    if (this.player && typeof this.player.removeEventListener === "function") {
      this.player.removeEventListener("ended", this.handleAutoplayEnded);
      this.player.removeEventListener("seeking", this.handleAutoplaySeeking);
      this.player.removeEventListener("seeked", this.handleAutoplaySeeked);
    }
  }

  private startInterval() {
    if (this.heartbeatIntervalTimer) return;
    if (!this.heartbeatInterval) {
      this.pendingHeartbeatStart = true;
      return;
    }
    this.heartbeatIntervalTimer = setInterval(() => {
      this.playerAnalytics.heartbeat({
        event: "heartbeat",
        ...this.playbackState(),
      });
    }, this.heartbeatInterval);
  }

  private stopInterval() {
    clearInterval(this.heartbeatIntervalTimer);
    this.heartbeatIntervalTimer = null;
    this.pendingHeartbeatStart = false;
  }

  public reportBitrateChange(payload: TBitrateChangedEventPayload) {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.bitrateChanged({
      event: "bitrate_changed",
      ...this.playbackState(),
      payload,
    });
  }

  public reportStop() {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.stopped({
      event: "stopped",
      ...this.playbackState(),
      payload: { reason: "aborted" },
    });
    this.stoppedReported = true;
    this.stopInterval();
  }

  public reportError(error: TErrorEventPayload) {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.error({
      event: "error",
      ...this.playbackState(),
      payload: error,
    });
    this.playerAnalytics.stopped({
      event: "stopped",
      ...this.playbackState(),
      payload: { reason: "error" },
    });
    this.stoppedReported = true;
    this.stopInterval();
  }

  public reportMetadata(payload: TMetadataEventPayload) {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.metadata({
      event: "metadata",
      ...this.playbackState(),
      payload,
    });
  }

  public reportWarning(payload: TWarningEventPayload) {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.playerAnalytics.warning({
      event: "warning",
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
      this.player?.currentTime != null && this.player.currentTime >= 0
        ? this.player?.currentTime
        : -1;
    return {
      sessionId: this.sessionId,
      timestamp: Date.now(),
      playhead,
      duration,
    };
  }

  private handlePageHide = () => {
    this.flushStoppedOnUnload();
  };

  private handleVisibilityChange = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      this.flushStoppedOnUnload();
    }
  };

  /**
   * Deliver a stopped event when the page is being unloaded (tab closed or
   * reloaded) mid-session. Listens on both `pagehide` and
   * `visibilitychange` (hidden) because the browser drops the normal CORS
   * fetch — which requires a preflight — during unload, losing the event. The
   * stopped event goes out over the reporter's beacon transport instead, and
   * only once per session (a later `ended`, reportStop(), or reportError()
   * will already have reported stopped).
   */
  private flushStoppedOnUnload() {
    if (!this.initCalled || this.stoppedReported || !this.player) {
      return;
    }
    this.stoppedReported = true;
    this.stopInterval();
    this.playerAnalytics.stoppedViaBeacon({
      event: "stopped",
      ...this.playbackState(),
      payload: { reason: "aborted" },
    });
  }

  private registerUnloadListeners() {
    if (this.unloadListenersRegistered) return;
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      window.addEventListener("pagehide", this.handlePageHide);
    }
    if (
      typeof document !== "undefined" &&
      typeof document.addEventListener === "function"
    ) {
      document.addEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
    }
    this.unloadListenersRegistered = true;
  }

  private removeUnloadListeners() {
    if (!this.unloadListenersRegistered) return;
    if (
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("pagehide", this.handlePageHide);
    }
    if (
      typeof document !== "undefined" &&
      typeof document.removeEventListener === "function"
    ) {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      );
    }
    this.unloadListenersRegistered = false;
  }

  public deinit() {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.initGeneration++; // Invalidate any pending init callbacks
    // Abort any in-flight init so queued events don't flush after teardown.
    // The next init() call creates a fresh Reporter, so destroying the
    // current one is safe even though deinit is meant to be reusable.
    this.playerAnalytics.destroy();
    this.stopInterval();
    this.removeUnloadListeners();
    this.detachAutoplayTerminalFallback();
    this.heartbeatInterval = null;
    this.videoEventFilter && this.videoEventFilter.teardown();
    this.videoEventFilter = null;
    this.analyticsInitiated = false;
    this.initCalled = false;
  }

  public destroy() {
    if (!this.initCalled) {
      console.warn("[PlayerAnalyticsConnector] Analytics not initiated");
      return;
    }
    this.initGeneration++; // Invalidate any pending init callbacks
    this.stopInterval();
    this.playerAnalytics.destroy();
    this.removeUnloadListeners();
    this.detachAutoplayTerminalFallback();
    this.heartbeatInterval = null;
    this.videoEventFilter && this.videoEventFilter.teardown();
    this.videoEventFilter = null;
    this.analyticsInitiated = false;
    this.initCalled = false;
  }
}
