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

    it("registers the pagehide listener (and NOT visibilitychange) on load()", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      // pagehide is the unload mechanism; a visibilitychange (tab switch) must
      // NOT be wired up to end the session (see #44).
      expect(typeof windowListeners["pagehide"]).toBe("function");
      expect(documentListeners["visibilitychange"]).toBeUndefined();
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

    it("does NOT end the session when the page becomes hidden (tab switch)", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      // Simulate a tab switch / backgrounding: the page goes hidden, but this
      // is not an unload. No visibilitychange listener is wired, so even if the
      // page fires one, nothing ends the session.
      docVisibility = "hidden";
      expect(documentListeners["visibilitychange"]).toBeUndefined();

      // No stopped beacon, and the one-shot guard is untouched so a later real
      // end still produces exactly one stopped.
      expect(sendBeaconSpy).not.toHaveBeenCalled();
      expect((connector as any).stoppedReported).toBe(false);
    });

    it("still delivers exactly one stopped beacon on a real unload (pagehide) after a hide", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      // Page hidden first (tab switch) — must not consume the one-shot...
      docVisibility = "hidden";
      // ...then a genuine unload (close/reload/navigate-away).
      docVisibility = "visible";
      windowListeners["pagehide"]();
      windowListeners["pagehide"]();

      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
      const body = await readBeaconBody();
      expect(body.event).toBe("stopped");
      expect(body.payload.reason).toBe("aborted");
    });

    it("delivers integrator reportStop() over the unload-safe beacon", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      mockVideoElement.currentTime = 12.5;
      connector.load(mockVideoElement);
      mockFetch.calls.reset();

      // Simulates an integrator calling reportStop() from a pagehide/unload
      // handler: it must go out over the beacon (not the normal CORS fetch
      // the browser drops during unload).
      connector.reportStop();

      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
      const body = await readBeaconBody();
      expect(body.event).toBe("stopped");
      expect(body.payload.reason).toBe("aborted");
      expect(body.playhead).toBe(12.5);
    });

    it("delivers exactly one stopped when reportStop() and the SDK unload path both run", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      // Integrator's unload reportStop() fires, then the SDK's own pagehide
      // handler runs. The stoppedReported guard must prevent a second beacon.
      connector.reportStop();
      windowListeners["pagehide"]();
      docVisibility = "hidden";
      documentListeners["visibilitychange"]();

      expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    });

    it("does not send an unload beacon after reportStop already stopped the session", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      connector.reportStop();
      sendBeaconSpy.calls.reset();
      mockFetch.calls.reset();

      windowListeners["pagehide"]();

      expect(sendBeaconSpy).not.toHaveBeenCalled();
    });

    it("reportStop() respects the stoppedReported guard set by ended (no duplicate)", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      // ENDED emits the terminal stopped and sets the guard.
      (connector as any).stoppedReported = true;
      sendBeaconSpy.calls.reset();
      mockFetch.calls.reset();

      connector.reportStop();

      expect(sendBeaconSpy).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("removes unload listeners on destroy()", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      connector.load(mockVideoElement);

      connector.destroy();

      expect(windowListeners["pagehide"]).toBeUndefined();
    });
  });

  describe("hidden page does not end a still-playing session (#44)", () => {
    let documentListeners: Record<string, (...args: any[]) => void>;
    let sendBeaconSpy: jasmine.Spy;
    let navigatorDescriptor: PropertyDescriptor | undefined;
    let docVisibility: string;

    beforeEach(() => {
      jasmine.clock().install();
      documentListeners = {};
      docVisibility = "visible";

      (globalThis as any).window = {
        addEventListener: () => {},
        removeEventListener: () => {},
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
      jasmine.clock().uninstall();
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      if (navigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      } else {
        delete (globalThis as any).navigator;
      }
    });

    it("keeps heartbeats running while hidden and after returning visible, with no stopped", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });
      connector.load(mockVideoElement);
      (connector as any).startInterval();

      // Page goes hidden (tab switch). No visibilitychange handler is wired, so
      // nothing stops the interval.
      docVisibility = "hidden";
      expect(documentListeners["visibilitychange"]).toBeUndefined();

      mockFetch.calls.reset();
      jasmine.clock().tick(5000);
      let events = mockFetch.calls
        .all()
        .map((c) => JSON.parse(c.args[1].body).event);
      // Heartbeat still fires while hidden; no stopped is emitted.
      expect(events).toContain("heartbeat");
      expect(events).not.toContain("stopped");

      // Back to visible: heartbeats keep going.
      docVisibility = "visible";
      mockFetch.calls.reset();
      jasmine.clock().tick(5000);
      events = mockFetch.calls
        .all()
        .map((c) => JSON.parse(c.args[1].body).event);
      expect(events).toContain("heartbeat");

      // The session was never ended by the hide.
      expect(sendBeaconSpy).not.toHaveBeenCalled();
      expect((connector as any).stoppedReported).toBe(false);
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

  describe("autoplay terminal/seek fallback (already-playing attach)", () => {
    async function flushMicrotasks() {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    // A video element whose add/removeEventListener actually register handlers,
    // so a DOM "ended"/"seeking"/"seeked" can be dispatched in-test. Models the
    // already-playing autoplay element the media-event-filter attaches to too
    // late to observe.
    function makePlayingElement(overrides: Record<string, any> = {}) {
      const listeners: Record<string, Set<(...a: any[]) => void>> = {};
      return {
        currentTime: 2,
        duration: 100,
        paused: false,
        ended: false,
        readyState: 4,
        addEventListener(type: string, cb: (...a: any[]) => void) {
          (listeners[type] || (listeners[type] = new Set())).add(cb);
        },
        removeEventListener(type: string, cb: (...a: any[]) => void) {
          listeners[type] && listeners[type].delete(cb);
        },
        __dispatch(type: string) {
          listeners[type] && listeners[type].forEach((cb) => cb({}));
        },
        ...overrides,
      } as any;
    }

    const bodies = () =>
      mockFetch.calls.all().map((c: any) => JSON.parse(c.args[1].body));

    it("reports exactly one stopped(ended) and stops heartbeats when an already-playing element ends", async () => {
      jasmine.clock().install();
      try {
        const connector = new PlayerAnalyticsConnector(
          "https://example.com/analytics"
        );
        await connector.init({
          sessionId: "test-session",
          heartbeatInterval: 5000,
        });
        await flushMicrotasks();

        const el = makePlayingElement();
        connector.load(el);

        // Heartbeats are running for the autoplay session.
        mockFetch.calls.reset();
        jasmine.clock().tick(5000);
        expect(bodies().map((b) => b.event)).toContain("heartbeat");

        // End of media.
        mockFetch.calls.reset();
        el.__dispatch("ended");

        const stopped = bodies().filter((b) => b.event === "stopped");
        expect(stopped.length).toBe(1);
        expect(stopped[0].payload.reason).toBe("ended");

        // Heartbeats stop after ended.
        mockFetch.calls.reset();
        jasmine.clock().tick(5000);
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it("reports seeking and seeked for an already-playing element", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });
      await flushMicrotasks();

      const el = makePlayingElement();
      connector.load(el);

      mockFetch.calls.reset();
      el.__dispatch("seeking");
      el.__dispatch("seeked");

      const events = bodies().map((b) => b.event);
      expect(events).toContain("seeking");
      expect(events).toContain("seeked");

      (connector as any).stopInterval();
    });

    it("does not emit a second stopped when the session was already stopped (reportStop)", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });
      await flushMicrotasks();

      const el = makePlayingElement();
      connector.load(el);

      connector.reportStop();
      mockFetch.calls.reset();

      el.__dispatch("ended");

      expect(bodies().filter((b) => b.event === "stopped").length).toBe(0);
    });

    it("does not attach the fallback for a paused element", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({ sessionId: "test-session" });
      await flushMicrotasks();

      const el = makePlayingElement({ paused: true });
      connector.load(el);

      mockFetch.calls.reset();
      el.__dispatch("ended");

      // No fallback => the DOM ended must not produce a stopped event.
      expect(bodies().filter((b) => b.event === "stopped").length).toBe(0);
      expect((connector as any).autoplayFallbackActive).toBe(false);
    });

    it("retires the DOM fallback once the media-event-filter goes live (seek reported once, not twice)", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });
      await flushMicrotasks();

      const el = makePlayingElement();
      connector.load(el);
      expect((connector as any).autoplayFallbackActive).toBe(true);

      // Drive the real media-event-filter out of its initial "loading" state:
      // a DOM "playing" makes it emit, so it becomes the authoritative source
      // and the DOM fallback must retire. Both the filter and the fallback are
      // registered for "seeking" on the element; retiring the fallback is what
      // prevents the seek from being reported twice.
      el.__dispatch("playing");
      expect((connector as any).autoplayFallbackActive).toBe(false);

      mockFetch.calls.reset();
      el.__dispatch("seeking");
      const seekingEvents = bodies().filter((b) => b.event === "seeking");
      expect(seekingEvents.length).toBe(1);

      (connector as any).stopInterval();
    });

    it("removes the fallback DOM listeners on destroy()", async () => {
      const connector = new PlayerAnalyticsConnector(
        "https://example.com/analytics"
      );
      await connector.init({
        sessionId: "test-session",
        heartbeatInterval: 5000,
      });
      await flushMicrotasks();

      const el = makePlayingElement();
      connector.load(el);
      expect((connector as any).autoplayFallbackActive).toBe(true);

      connector.destroy();
      expect((connector as any).autoplayFallbackActive).toBe(false);

      mockFetch.calls.reset();
      el.__dispatch("ended");
      expect(bodies().filter((b) => b.event === "stopped").length).toBe(0);
    });
  });
});
