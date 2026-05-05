import {
  PlayerAnalytics,
  IPlayerAnalyticsInitOptions,
} from "../src/PlayerAnalytics";
import {
  TPlayingEvent,
  TPausedEvent,
  TBufferingEvent,
  TErrorEvent,
  TMetadataEvent,
} from "@eyevinn/player-analytics-specification";

describe("PlayerAnalytics", () => {
  let mockFetch: jasmine.Spy;
  let originalFetch: any;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = jasmine.createSpy("fetch").and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessionId: "test-session-id" }),
        statusText: "OK",
      } as Response)
    );
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("initiateAnalyticsReporter()", () => {
    it("should create Reporter and call init", async () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");

      // Mock returns empty response, so provided sessionId is kept
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
          statusText: "OK",
        } as Response)
      );

      const options: IPlayerAnalyticsInitOptions = {
        sessionId: "my-session-id",
        heartbeatInterval: 30000,
      };

      const result = await analytics.initiateAnalyticsReporter(options);

      expect(result.sessionId).toBe("my-session-id");
      expect(result.heartbeatInterval).toBe(30000);
      expect(result.isInitiated).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should use default heartbeatInterval when not provided", async () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");

      const result = await analytics.initiateAnalyticsReporter({});

      expect(result.heartbeatInterval).toBe(30000); // HEARTBEAT_INTERVAL constant
    });

    it("should pass shardId to Reporter", async () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");

      const options: IPlayerAnalyticsInitOptions = {
        sessionId: "session-123",
        shardId: "shard-456",
      };

      await analytics.initiateAnalyticsReporter(options);

      // Verify shardId is included in init request
      const bodyString = mockFetch.calls.argsFor(0)[1].body;
      const body = JSON.parse(bodyString);
      expect(body.shardId).toBe("shard-456");
    });
  });

  describe("event methods before init", () => {
    it("should warn and return when calling playing() before init", () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");
      spyOn(console, "warn");

      const eventData: TPlayingEvent = {
        event: "playing",
        sessionId: "test",
        timestamp: Date.now(),
        playhead: 0,
        duration: 100,
      };

      analytics.playing(eventData);

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalytics] Not initialized. Call initiateAnalyticsReporter() first."
      );
    });

    it("should warn and return when calling pause() before init", () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");
      spyOn(console, "warn");

      const eventData: TPausedEvent = {
        event: "paused",
        sessionId: "test",
        timestamp: Date.now(),
        playhead: 5,
        duration: 100,
      };

      analytics.pause(eventData);

      expect(console.warn).toHaveBeenCalled();
    });

    it("should warn and return when calling buffering() before init", () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");
      spyOn(console, "warn");

      const eventData: TBufferingEvent = {
        event: "buffering",
        sessionId: "test",
        timestamp: Date.now(),
        playhead: 10,
        duration: 100,
      };

      analytics.buffering(eventData);

      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe("event methods after init", () => {
    let analytics: PlayerAnalytics;

    beforeEach(async () => {
      analytics = new PlayerAnalytics("https://example.com/analytics");
      await analytics.initiateAnalyticsReporter({ sessionId: "test-session" });
      mockFetch.calls.reset();
    });

    it("should call reporter.send with correct data for playing()", () => {
      const eventData: TPlayingEvent = {
        event: "playing",
        sessionId: "test-session",
        timestamp: 1234567890,
        playhead: 0,
        duration: 100,
      };

      analytics.playing(eventData);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("playing");
      // Reporter uses its authoritative sessionId (from server init response)
      expect(body.sessionId).toBe("test-session-id");
    });

    it("should call reporter.send with correct data for pause()", () => {
      const eventData: TPausedEvent = {
        event: "paused",
        sessionId: "test-session",
        timestamp: 1234567890,
        playhead: 15,
        duration: 100,
      };

      analytics.pause(eventData);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("paused");
      expect(body.playhead).toBe(15);
    });

    it("should call reporter.send with correct data for buffering()", () => {
      const eventData: TBufferingEvent = {
        event: "buffering",
        sessionId: "test-session",
        timestamp: 1234567890,
        playhead: 20,
        duration: 100,
      };

      analytics.buffering(eventData);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("buffering");
    });

    it("should call reporter.send with correct data for error()", () => {
      const eventData: TErrorEvent = {
        event: "error",
        sessionId: "test-session",
        timestamp: 1234567890,
        playhead: 25,
        duration: 100,
        payload: {
          category: "network",
          code: "MEDIA_ERR_NETWORK",
          message: "Failed to load media",
        },
      };

      analytics.error(eventData);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("error");
      expect(body.payload.category).toBe("network");
    });

    it("should call reporter.send with correct data for metadata()", () => {
      const eventData: TMetadataEvent = {
        event: "metadata",
        sessionId: "test-session",
        timestamp: 1234567890,
        playhead: 0,
        duration: 100,
        payload: {
          contentId: "content-123",
          contentUrl: "https://example.com/video.m3u8",
          live: false,
        },
      };

      analytics.metadata(eventData);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("metadata");
      expect(body.payload.contentId).toBe("content-123");
    });

    it("should call reporter.send for all event types", () => {
      const baseEvent = {
        sessionId: "test-session",
        timestamp: Date.now(),
        playhead: 0,
        duration: 100,
      };

      analytics.loading({ event: "loading", ...baseEvent });
      analytics.loaded({ event: "loaded", ...baseEvent });
      analytics.seeking({ event: "seeking", ...baseEvent });
      analytics.seeked({ event: "seeked", ...baseEvent });
      analytics.buffered({ event: "buffered", ...baseEvent });
      analytics.bitrateChanged({
        event: "bitrate_changed",
        ...baseEvent,
        payload: { bitrate: 5000000 },
      });
      analytics.warning({
        event: "warning",
        ...baseEvent,
        payload: { category: "player", code: "WARN_001", message: "Warning" },
      });
      analytics.stopped({
        event: "stopped",
        ...baseEvent,
        payload: { reason: "ended" },
      });
      analytics.heartbeat({ event: "heartbeat", ...baseEvent });

      expect(mockFetch).toHaveBeenCalledTimes(9);
    });
  });

  describe("destroy()", () => {
    it("should nullify reporter", async () => {
      const analytics = new PlayerAnalytics("https://example.com/analytics");
      await analytics.initiateAnalyticsReporter({ sessionId: "test-session" });

      analytics.destroy();

      spyOn(console, "warn");
      analytics.playing({
        event: "playing",
        sessionId: "test",
        timestamp: Date.now(),
        playhead: 0,
        duration: 100,
      });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalytics] Not initialized. Call initiateAnalyticsReporter() first."
      );
    });
  });

  describe("debug mode", () => {
    it("should not call fetch when debug mode is enabled", async () => {
      const analytics = new PlayerAnalytics(
        "https://example.com/analytics",
        true
      );

      spyOn(console, "log");

      await analytics.initiateAnalyticsReporter({ sessionId: "debug-session" });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it("should log events to console in debug mode", async () => {
      const analytics = new PlayerAnalytics(
        "https://example.com/analytics",
        true
      );

      spyOn(console, "log");

      await analytics.initiateAnalyticsReporter({ sessionId: "debug-session" });

      const eventData: TPlayingEvent = {
        event: "playing",
        sessionId: "debug-session",
        timestamp: 1234567890,
        playhead: 0,
        duration: 100,
      };

      analytics.playing(eventData);

      expect(console.log).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
