import { PlayerAnalyticsConnector, IPlayerAnalyticsConnectorInitOptions } from "../src/PlayerAnalyticsConnector";

describe("PlayerAnalyticsConnector", () => {
  let mockFetch: jasmine.Spy;
  let originalFetch: any;
  let mockVideoElement: any;

  beforeEach(() => {
    // Mock fetch
    originalFetch = globalThis.fetch;
    mockFetch = jasmine.createSpy("fetch").and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessionId: "test-session-id" }),
        statusText: "OK",
      } as Response)
    );
    globalThis.fetch = mockFetch;

    // Mock HTMLVideoElement
    mockVideoElement = {
      currentTime: 0,
      duration: 100,
      addEventListener: jasmine.createSpy("addEventListener"),
      removeEventListener: jasmine.createSpy("removeEventListener"),
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("init()", () => {
    it("should initialize analytics reporter and set analyticsInitiated to true", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");

      const options: IPlayerAnalyticsConnectorInitOptions = {
        sessionId: "session-123",
        heartbeatInterval: 30000,
      };

      await connector.init(options);

      expect(mockFetch).toHaveBeenCalled();
      expect((connector as any).analyticsInitiated).toBe(true);
    });

    it("should store heartbeatInterval from init response", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");

      await connector.init({ heartbeatInterval: 45000 });

      expect((connector as any).heartbeatInterval).toBe(45000);
    });
  });

  describe("load()", () => {
    it("should set player reference and send loading event", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      mockFetch.calls.reset();

      connector.load(mockVideoElement);

      expect((connector as any).player).toBe(mockVideoElement);
      expect(mockFetch).toHaveBeenCalled();

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("loading");
    });

    it("should initiate video event filter", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      connector.load(mockVideoElement);

      expect((connector as any).videoEventFilter).toBeDefined();
    });
  });

  describe("playbackState()", () => {
    it("should return playhead 0 when currentTime is 0", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 0;
      mockVideoElement.duration = 100;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: false });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.playhead).toBe(0);
      expect(body.duration).toBe(100);
    });

    it("should return duration -1 for live stream (Infinity duration)", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 10;
      mockVideoElement.duration = Infinity;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: true });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.duration).toBe(-1);
      expect(body.playhead).toBe(-1);
    });

    it("should return playhead -1 when duration is -1", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 10;
      mockVideoElement.duration = 0;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: false });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.duration).toBe(-1);
      expect(body.playhead).toBe(-1);
    });

    it("should return correct playhead for normal playback", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 42.5;
      mockVideoElement.duration = 120;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: false });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.playhead).toBe(42.5);
      expect(body.duration).toBe(120);
    });
  });

  describe("heartbeat", () => {
    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it("should start heartbeat interval when startInterval is called", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session", heartbeatInterval: 10000 });

      connector.load(mockVideoElement);

      // Manually trigger startInterval (normally triggered by playing event)
      (connector as any).startInterval();

      mockFetch.calls.reset();

      jasmine.clock().tick(10000);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("heartbeat");
    });

    it("should not start duplicate interval if already running", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session", heartbeatInterval: 10000 });

      connector.load(mockVideoElement);

      (connector as any).startInterval();
      (connector as any).startInterval();

      mockFetch.calls.reset();
      jasmine.clock().tick(10000);

      // Should only fire once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should stop heartbeat interval when stopInterval is called", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session", heartbeatInterval: 10000 });

      connector.load(mockVideoElement);

      (connector as any).startInterval();
      (connector as any).stopInterval();

      mockFetch.calls.reset();
      jasmine.clock().tick(10000);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should restart heartbeat after stop", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session", heartbeatInterval: 5000 });

      connector.load(mockVideoElement);

      (connector as any).startInterval();
      jasmine.clock().tick(5000);
      (connector as any).stopInterval();

      mockFetch.calls.reset();

      (connector as any).startInterval();
      jasmine.clock().tick(5000);

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("heartbeat");
    });
  });

  describe("report methods when not initialized", () => {
    it("should warn when reportBitrateChange is called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.reportBitrateChange({ bitrate: 5000000 });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should warn when reportMetadata is called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.reportMetadata({ contentId: "test", live: false });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });

    it("should warn when reportError is called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.reportError({
        category: "network",
        code: "MEDIA_ERR_NETWORK",
        message: "Network error",
      });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });

    it("should warn when reportStop is called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.reportStop();

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });

    it("should warn when reportWarning is called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.reportWarning({
        category: "player",
        code: "WARN_001",
        message: "Warning message",
      });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });
  });

  describe("report methods when initialized", () => {
    let connector: PlayerAnalyticsConnector;

    beforeEach(async () => {
      connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);
      mockFetch.calls.reset();
    });

    it("should send bitrate_changed event with correct payload", () => {
      connector.reportBitrateChange({ bitrate: 5000000, width: 1920, height: 1080 });

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("bitrate_changed");
      expect(body.payload.bitrate).toBe(5000000);
      expect(body.payload.width).toBe(1920);
      expect(body.payload.height).toBe(1080);
    });

    it("should send stopped event with reason aborted when reportStop is called", () => {
      connector.reportStop();

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("stopped");
      expect(body.payload.reason).toBe("aborted");
    });

    it("should send error and stopped events when reportError is called", () => {
      connector.reportError({
        category: "network",
        code: "MEDIA_ERR_NETWORK",
        message: "Network error",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const errorBody = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(errorBody.event).toBe("error");
      expect(errorBody.payload.category).toBe("network");

      const stoppedBody = JSON.parse(mockFetch.calls.argsFor(1)[1].body);
      expect(stoppedBody.event).toBe("stopped");
      expect(stoppedBody.payload.reason).toBe("error");
    });

    it("should send metadata event with correct payload", () => {
      connector.reportMetadata({
        contentId: "video-123",
        contentUrl: "https://example.com/video.m3u8",
        live: false,
        drmType: "widevine",
      });

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("metadata");
      expect(body.payload.contentId).toBe("video-123");
      expect(body.payload.live).toBe(false);
      expect(body.payload.drmType).toBe("widevine");
    });

    it("should send warning event with correct payload", () => {
      connector.reportWarning({
        category: "player",
        code: "WARN_001",
        message: "Warning message",
      });

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("warning");
      expect(body.payload.category).toBe("player");
    });
  });

  describe("deinit()", () => {
    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it("should set analyticsInitiated to false", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      connector.deinit();

      expect((connector as any).analyticsInitiated).toBe(false);
    });

    it("should stop heartbeat interval", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session", heartbeatInterval: 5000 });

      connector.load(mockVideoElement);
      (connector as any).startInterval();

      connector.deinit();

      mockFetch.calls.reset();
      jasmine.clock().tick(5000);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should teardown video event filter", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      connector.load(mockVideoElement);

      const teardownSpy = jasmine.createSpy("teardown");
      (connector as any).videoEventFilter = { teardown: teardownSpy };

      connector.deinit();

      expect(teardownSpy).toHaveBeenCalled();
      expect((connector as any).videoEventFilter).toBeNull();
    });

    it("should warn when called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.deinit();

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });
  });

  describe("destroy()", () => {
    beforeEach(() => {
      jasmine.clock().install();
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it("should set analyticsInitiated to false", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      connector.destroy();

      expect((connector as any).analyticsInitiated).toBe(false);
    });

    it("should stop heartbeat and teardown filter", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session", heartbeatInterval: 5000 });

      connector.load(mockVideoElement);
      (connector as any).startInterval();

      const teardownSpy = jasmine.createSpy("teardown");
      (connector as any).videoEventFilter = { teardown: teardownSpy };

      connector.destroy();

      mockFetch.calls.reset();
      jasmine.clock().tick(5000);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(teardownSpy).toHaveBeenCalled();
    });

    it("should destroy playerAnalytics instance", async () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      await connector.init({ sessionId: "test-session" });

      spyOn((connector as any).playerAnalytics, "destroy");

      connector.destroy();

      expect((connector as any).playerAnalytics.destroy).toHaveBeenCalled();
    });

    it("should warn when called before init", () => {
      const connector = new PlayerAnalyticsConnector("https://example.com/analytics");
      spyOn(console, "warn");

      connector.destroy();

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });
  });

  describe("onError callback", () => {
    it("should invoke onError callback on send failure", async () => {
      const errorCallback = jasmine.createSpy("onError");
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics",
        false,
        errorCallback,
      );
      await connector.init({ sessionId: "test-session" });

      // Make subsequent fetches fail with 404
      mockFetch.and.returnValue(Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }));

      connector.load(mockVideoElement);

      // Trigger a send via reportStop
      connector.reportStop();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(errorCallback).toHaveBeenCalledWith(
        jasmine.objectContaining({ status: 404, statusText: "Not Found" }),
        jasmine.objectContaining({ event: "stopped" }),
      );
    });
  });
});
