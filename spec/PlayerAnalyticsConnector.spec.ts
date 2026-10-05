import {
  PlayerAnalyticsConnector,
  IPlayerAnalyticsConnectorInitOptions,
} from "../src/PlayerAnalyticsConnector";

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

  describe("page unload (stopped via beacon)", () => {
    let windowListeners: Record<string, (...args: any[]) => void>;
    let documentListeners: Record<string, (...args: any[]) => void>;
    let sendBeaconSpy: jasmine.Spy;
    let navigatorDescriptor: PropertyDescriptor | undefined;
    let docVisibility: string;

    beforeEach(() => {
      windowListeners = {};
      documentListeners = {};
      docVisibility = "visible";

      (globalThis as any).window = {
        addEventListener: (type: string, cb: (...args: any[]) => void) => {
          windowListeners[type] = cb;
        },
        removeEventListener: (type: string) => {
          delete windowListeners[type];
        },
      };
      (globalThis as any).document = {
        addEventListener: (type: string, cb: (...args: any[]) => void) => {
          documentListeners[type] = cb;
        },
        removeEventListener: (type: string) => {
          delete documentListeners[type];
        },
        get visibilityState() {
          return docVisibility;
        },
      };

      sendBeaconSpy = jasmine.createSpy("sendBeacon").and.returnValue(true);
      navigatorDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "navigator"
      );
      Object.defineProperty(globalThis, "navigator", {
        value: { sendBeacon: sendBeaconSpy },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      } else {
        delete (globalThis as any).navigator;
      }
    });

    async function readBeaconBody(): Promise<any> {
      const blob = sendBeaconSpy.calls.mostRecent().args[1] as Blob;
      return JSON.parse(await blob.text());
    }

    it("registers pagehide and visibilitychange listeners on load()", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      expect(typeof windowListeners["pagehide"]).toBe("function");
      expect(typeof documentListeners["visibilitychange"]).toBe("function");
    });

    it("sends a stopped beacon (reason aborted) on pagehide", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      mockVideoElement.currentTime = 42.5;
      mockVideoElement.duration = 120;
      connector.load(mockVideoElement);
      mockFetch.calls.reset();

      windowListeners["pagehide"]();

      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
      const body = await readBeaconBody();
      expect(body.event).toBe("stopped");
      expect(body.payload.reason).toBe("aborted");
      // Server init response's sessionId is authoritative
      expect(body.sessionId).toBe("test-session-id");
      expect(body.playhead).toBe(42.5);
    });

    it("sends a stopped beacon on visibilitychange when hidden", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      docVisibility = "hidden";
      documentListeners["visibilitychange"]();

      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
      const body = await readBeaconBody();
      expect(body.event).toBe("stopped");
    });

    it("does not send on visibilitychange while still visible", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      docVisibility = "visible";
      documentListeners["visibilitychange"]();

      expect(sendBeaconSpy).not.toHaveBeenCalled();
    });

    it("sends the stopped beacon only once per session", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      windowListeners["pagehide"]();
      docVisibility = "hidden";
      documentListeners["visibilitychange"]();
      windowListeners["pagehide"]();

      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    });

    it("does not send an unload beacon after reportStop already stopped the session", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      connector.reportStop();
      mockFetch.calls.reset();

      windowListeners["pagehide"]();

      expect(sendBeaconSpy).not.toHaveBeenCalled();
    });

    it("removes unload listeners on destroy()", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      connector.destroy();

      expect(windowListeners["pagehide"]).toBeUndefined();
      expect(documentListeners["visibilitychange"]).toBeUndefined();
    });
  });

  describe("init()", () => {
    it("should initialize analytics reporter and set analyticsInitiated to true", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );

      const options: IPlayerAnalyticsConnectorInitOptions = {
        sessionId: "session-123",
        heartbeatInterval: 30000,
      };

      await connector.init(options);

      expect(mockFetch).toHaveBeenCalled();
      expect((connector as any).analyticsInitiated).toBe(true);
    });

    it("should store heartbeatInterval from init response", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );

      await connector.init({ heartbeatInterval: 45000 });

      expect((connector as any).heartbeatInterval).toBe(45000);
    });
  });

  describe("load()", () => {
    it("should set player reference and send loading event", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      mockFetch.calls.reset();

      connector.load(mockVideoElement);

      expect((connector as any).player).toBe(mockVideoElement);
      expect(mockFetch).toHaveBeenCalled();

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("loading");
    });

    it("should initiate video event filter", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      connector.load(mockVideoElement);

      expect((connector as any).videoEventFilter).toBeDefined();
    });
  });

  describe("playbackState()", () => {
    it("should return playhead 0 when currentTime is 0", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 10;
      mockVideoElement.duration = Infinity;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: true });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.duration).toBe(-1);
    });

    it("should report a valid playhead for live content (Infinity duration)", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 37.5;
      mockVideoElement.duration = Infinity;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: true });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      // Playhead must be decoupled from duration: -1 means "unknown", not "live".
      expect(body.duration).toBe(-1);
      expect(body.playhead).not.toBe(-1);
      expect(body.playhead).toBe(37.5);
    });

    it("should report a valid playhead for VOD before duration metadata is available", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      // Duration not yet known (e.g. loadedmetadata hasn't fired) but the
      // player already exposes a valid currentTime.
      mockVideoElement.currentTime = 5;
      mockVideoElement.duration = undefined;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: false });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.duration).toBe(-1);
      expect(body.playhead).not.toBe(-1);
      expect(body.playhead).toBe(5);
    });

    it("should normalize duration 0 to -1 while keeping a valid playhead", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = 10;
      mockVideoElement.duration = 0;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: false });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.duration).toBe(-1);
      // Playhead is independent of duration normalization.
      expect(body.playhead).toBe(10);
    });

    it("should return playhead -1 when currentTime is invalid", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      mockVideoElement.currentTime = -1;
      mockVideoElement.duration = 100;

      connector.load(mockVideoElement);

      mockFetch.calls.reset();
      connector.reportMetadata({ contentId: "test", live: false });

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.playhead).toBe(-1);
    });

    it("should return correct playhead for normal playback", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 10000,
      });

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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 10000,
      });

      connector.load(mockVideoElement);

      (connector as any).startInterval();
      (connector as any).startInterval();

      mockFetch.calls.reset();
      jasmine.clock().tick(10000);

      // Should only fire once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should stop heartbeat interval when stopInterval is called", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 10000,
      });

      connector.load(mockVideoElement);

      (connector as any).startInterval();
      (connector as any).stopInterval();

      mockFetch.calls.reset();
      jasmine.clock().tick(10000);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should restart heartbeat after stop", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });

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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      spyOn(console, "warn");

      connector.reportBitrateChange({ bitrate: 5000000 });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should warn when reportMetadata is called before init", () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      spyOn(console, "warn");

      connector.reportMetadata({ contentId: "test", live: false });

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });

    it("should warn when reportError is called before init", () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      spyOn(console, "warn");

      connector.reportStop();

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });

    it("should warn when reportWarning is called before init", () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
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
      connector.reportBitrateChange({
        bitrate: 5000000,
        width: 1920,
        height: 1080,
      });

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

    it("should send warning event with all TWarningEventPayload fields", () => {
      connector.reportWarning({
        category: "decoder",
        code: "CODEC_FALLBACK",
        message: "Fell back to software decoding",
        data: { codec: "hevc", fallback: "avc1" },
      });

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("warning");
      expect(body.payload.category).toBe("decoder");
      expect(body.payload.code).toBe("CODEC_FALLBACK");
      expect(body.payload.message).toBe("Fell back to software decoding");
      expect(body.payload.data).toEqual({ codec: "hevc", fallback: "avc1" });
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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      connector.deinit();

      expect((connector as any).analyticsInitiated).toBe(false);
    });

    it("should stop heartbeat interval", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });

      connector.load(mockVideoElement);
      (connector as any).startInterval();

      connector.deinit();

      mockFetch.calls.reset();
      jasmine.clock().tick(5000);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should teardown video event filter", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      connector.load(mockVideoElement);

      const teardownSpy = jasmine.createSpy("teardown");
      (connector as any).videoEventFilter = { teardown: teardownSpy };

      connector.deinit();

      expect(teardownSpy).toHaveBeenCalled();
      expect((connector as any).videoEventFilter).toBeNull();
    });

    it("should warn when called before init", () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      connector.destroy();

      expect((connector as any).analyticsInitiated).toBe(false);
    });

    it("should stop heartbeat and teardown filter", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });

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
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });

      spyOn((connector as any).playerAnalytics, "destroy");

      connector.destroy();

      expect((connector as any).playerAnalytics.destroy).toHaveBeenCalled();
    });

    it("should warn when called before init", () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      spyOn(console, "warn");

      connector.destroy();

      expect(console.warn).toHaveBeenCalledWith(
        "[PlayerAnalyticsConnector] Analytics not initiated"
      );
    });
  });

  describe("non-blocking init", () => {
    // Helper: flush promise microtask queue
    async function flushMicrotasks() {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    // Type-safe access to private members for test assertions
    interface ConnectorInternals {
      sessionId: string;
      pendingHeartbeatStart: boolean;
      heartbeatIntervalTimer: ReturnType<typeof setInterval> | null;
      startInterval: () => void;
      stopInterval: () => void;
    }

    it("should allow load() before init resolves (events queued)", async () => {
      let resolveInit!: (value: unknown) => void;
      const pendingInit = new Promise((resolve) => {
        resolveInit = resolve;
      });
      mockFetch.and.returnValue(pendingInit);

      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      const initPromise = connector.init({ sessionId: "test-session" });

      mockFetch.calls.reset();
      connector.load(mockVideoElement);

      expect(mockFetch).not.toHaveBeenCalled();

      resolveInit({
        ok: true,
        json: () => Promise.resolve({ sessionId: "test-session" }),
        statusText: "OK",
      });

      await initPromise;
      await flushMicrotasks();

      expect(mockFetch).toHaveBeenCalled();
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.event).toBe("loading");
    });

    it("should update sessionId from server response", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );

      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ sessionId: "server-generated-id" }),
          statusText: "OK",
        })
      );

      await connector.init({ sessionId: "client-id" });
      await flushMicrotasks();

      const internals = connector as unknown as ConnectorInternals;
      expect(internals.sessionId).toBe("server-generated-id");
    });

    it("should defer heartbeat start if PLAYING fires before init resolves", async () => {
      let resolveInit!: (value: unknown) => void;
      const pendingInit = new Promise((resolve) => {
        resolveInit = resolve;
      });
      mockFetch.and.returnValue(pendingInit);

      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      const initPromise = connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });

      const internals = connector as unknown as ConnectorInternals;
      internals.startInterval();

      expect(internals.pendingHeartbeatStart).toBe(true);
      expect(internals.heartbeatIntervalTimer).toBeUndefined();

      resolveInit({
        ok: true,
        json: () => Promise.resolve({ sessionId: "test-session" }),
        statusText: "OK",
      });

      await initPromise;
      await flushMicrotasks();

      expect(internals.pendingHeartbeatStart).toBe(false);
      expect(internals.heartbeatIntervalTimer).toBeDefined();

      internals.stopInterval();
    });

    it("should drop queued events when deinit() is called during init", async () => {
      // Same as the destroy() case but for deinit() — must also cascade
      // to reporter.destroy() to abort the in-flight init.
      let resolveInit!: (value: unknown) => void;
      const pendingInit = new Promise((resolve) => {
        resolveInit = resolve;
      });
      mockFetch.and.returnValue(pendingInit);

      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      const initPromise = connector.init({ sessionId: "test-session" });

      mockFetch.calls.reset();
      connector.load(mockVideoElement);
      // 'loading' is queued at this point

      // Deinit mid-init (instead of destroy)
      connector.deinit();

      resolveInit({
        ok: true,
        json: () => Promise.resolve({ sessionId: "test-session" }),
        statusText: "OK",
      });

      try {
        await initPromise;
      } catch {
        /* expected */
      }
      await flushMicrotasks();

      // No event should reach the wire after deinit
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should drop queued events when destroy() is called during init", async () => {
      // End-to-end: load() during pending init queues a 'loading' event.
      // destroy() must abort the init and prevent that event from reaching the wire.
      let resolveInit!: (value: unknown) => void;
      const pendingInit = new Promise((resolve) => {
        resolveInit = resolve;
      });
      mockFetch.and.returnValue(pendingInit);

      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      const initPromise = connector.init({ sessionId: "test-session" });

      mockFetch.calls.reset();
      connector.load(mockVideoElement);
      // 'loading' is queued at this point

      // Destroy mid-init
      connector.destroy();

      resolveInit({
        ok: true,
        json: () => Promise.resolve({ sessionId: "test-session" }),
        statusText: "OK",
      });

      try {
        await initPromise;
      } catch {
        /* expected */
      }
      await flushMicrotasks();

      // No event should reach the wire after destroy
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should send playing and start heartbeats for autoplay that started during a slow init() handshake", async () => {
      // init() resolves slowly. Autoplay begins during the handshake, so the
      // DOM "playing" event fires before the media-event-filter is attached and
      // is never re-emitted. load() must detect the already-playing element,
      // emit a queued 'playing', and arrange for heartbeats to start once init
      // resolves.
      jasmine.clock().install();
      try {
        let resolveInit!: (value: unknown) => void;
        const pendingInit = new Promise((resolve) => {
          resolveInit = resolve;
        });
        mockFetch.and.returnValue(pendingInit);

        const connector = new PlayerAnalyticsConnector(
          "https://example.com/analytics"
        );
        const initPromise = connector.init({
          sessionId: "test-session",
          heartbeatInterval: 5000,
        });

        // Element already playing by the time load() is called.
        const playingElement = {
          ...mockVideoElement,
          paused: false,
          ended: false,
          readyState: 4,
          currentTime: 2,
          duration: 100,
        };

        mockFetch.calls.reset();
        connector.load(playingElement);

        // Events are queued until the handshake completes.
        expect(mockFetch).not.toHaveBeenCalled();

        resolveInit({
          ok: true,
          json: () => Promise.resolve({ sessionId: "test-session" }),
          statusText: "OK",
        });

        await initPromise;
        await flushMicrotasks();

        // The queued 'loading' and 'playing' events must both reach the wire.
        const events = mockFetch.calls
          .all()
          .map((c) => JSON.parse(c.args[1].body).event);
        expect(events).toContain("loading");
        expect(events).toContain("playing");

        // Heartbeats must now be running (deferred start fired on init resolve).
        mockFetch.calls.reset();
        jasmine.clock().tick(5000);
        const heartbeatEvents = mockFetch.calls
          .all()
          .map((c) => JSON.parse(c.args[1].body).event);
        expect(heartbeatEvents).toContain("heartbeat");

        (connector as unknown as ConnectorInternals).stopInterval();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it("should send playing immediately when element is already playing and init already resolved", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });
      await flushMicrotasks();

      const playingElement = {
        ...mockVideoElement,
        paused: false,
        ended: false,
        readyState: 4,
      };

      mockFetch.calls.reset();
      connector.load(playingElement);

      const events = mockFetch.calls
        .all()
        .map((c) => JSON.parse(c.args[1].body).event);
      expect(events).toContain("loading");
      expect(events).toContain("playing");

      (connector as unknown as ConnectorInternals).stopInterval();
    });

    it("should NOT emit a playing event on load() when the element is paused", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      await flushMicrotasks();

      const pausedElement = {
        ...mockVideoElement,
        paused: true,
        ended: false,
        readyState: 4,
      };

      mockFetch.calls.reset();
      connector.load(pausedElement);

      const events = mockFetch.calls
        .all()
        .map((c) => JSON.parse(c.args[1].body).event);
      expect(events).not.toContain("playing");
    });

    it("should reset pendingHeartbeatStart on init failure (no stale flag for retry)", async () => {
      // First init: PLAYING fires before init completes (sets pendingHeartbeatStart),
      // then init fails. The flag must be cleared so a retry doesn't fire heartbeats
      // without a new PLAYING event.
      mockFetch.and.returnValue(
        Promise.resolve({
          ok: false,
          statusText: "Service Unavailable",
        })
      );

      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      const initPromise = connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });

      const internals = connector as unknown as ConnectorInternals;
      // Simulate PLAYING event during init
      internals.startInterval();
      expect(internals.pendingHeartbeatStart).toBe(true);

      try {
        await initPromise;
      } catch {
        /* expected */
      }
      await flushMicrotasks();

      // pendingHeartbeatStart must be cleared after init failure
      expect(internals.pendingHeartbeatStart).toBe(false);
    });
  });
});
