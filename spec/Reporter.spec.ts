import { Reporter, IReporterOptions } from "../src/utils/Reporter";
import { TPlayerAnalyticsEvent } from "@eyevinn/player-analytics-specification";

describe("Reporter", () => {
  let mockFetch: jasmine.Spy;
  let originalFetch: any;

  beforeEach(() => {
    // Save original fetch
    originalFetch = globalThis.fetch;

    // Mock fetch globally
    mockFetch = jasmine.createSpy("fetch").and.returnValue(
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ sessionId: "server-generated-id" }),
        statusText: "OK",
      } as Response)
    );
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  describe("init()", () => {
    it("should call fetch with correct URL and headers", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        heartbeatInterval: 30000,
      };
      const reporter = new Reporter(options);

      await reporter.init();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, fetchOptions] = mockFetch.calls.argsFor(0);
      expect(url).toBe("https://example.com/analytics");
      expect(fetchOptions.method).toBe("POST");
      expect(fetchOptions.headers["Content-Type"]).toBe("application/json; charset=utf-8");
      expect(fetchOptions.headers["X-EPAS-Event"]).toBe("init");
      expect(fetchOptions.headers["X-EPAS-Version"]).toBeDefined();
    });

    it("should return sessionId from server response", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
      };
      const reporter = new Reporter(options);

      const result = await reporter.init();

      expect(result.sessionId).toBe("server-generated-id");
      expect(result.heartbeatInterval).toBeDefined();
      expect(result.isInitiated).toBe(true);
    });

    it("should reuse provided sessionId when given", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "existing-session-id",
      };
      const reporter = new Reporter(options);

      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
          statusText: "OK",
        } as Response)
      );

      const result = await reporter.init("existing-session-id");

      expect(result.sessionId).toBe("existing-session-id");

      const bodyString = mockFetch.calls.argsFor(0)[1].body;
      const body = JSON.parse(bodyString);
      expect(body.sessionId).toBe("existing-session-id");
    });

    it("should handle fetch rejection gracefully", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
      };
      const reporter = new Reporter(options);

      mockFetch.and.returnValue(Promise.reject(new Error("Network error")));

      await expectAsync(reporter.init()).toBeRejectedWithError("Network error");
    });

    it("should throw error when init response is not ok", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
      };
      const reporter = new Reporter(options);

      mockFetch.and.returnValue(
        Promise.resolve({
          ok: false,
          statusText: "Internal Server Error",
        } as Response)
      );

      await expectAsync(reporter.init()).toBeRejectedWithError(
        "[AnalyticsReporter] init failed: Internal Server Error"
      );
    });

    it("should throw error when no sessionId in response and none provided", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
      };
      const reporter = new Reporter(options);

      mockFetch.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
          statusText: "OK",
        } as Response)
      );

      await expectAsync(reporter.init()).toBeRejectedWithError(
        "[AnalyticsReporter] init failed: no sessionId"
      );
    });

    it("should not call fetch in debug mode", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "debug-session-id",
        debug: true,
      };
      const reporter = new Reporter(options);

      spyOn(console, "log");

      const result = await reporter.init();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.sessionId).toBe("debug-session-id");
      expect(result.isInitiated).toBe(true);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe("send()", () => {
    it("should call fetch with correct JSON body and EPAS headers", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
      };
      const reporter = new Reporter(options);
      await reporter.init();

      mockFetch.calls.reset();

      const eventData: TPlayerAnalyticsEvent = {
        event: "playing",
        sessionId: "test-session-id",
        timestamp: 1234567890,
        playhead: 10.5,
        duration: 120,
      };

      reporter.send(eventData);

      // Wait for async fetch to be called
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, fetchOptions] = mockFetch.calls.argsFor(0);
      expect(url).toBe("https://example.com/analytics");
      expect(fetchOptions.method).toBe("POST");
      expect(fetchOptions.headers["X-EPAS-Event"]).toBe("playing");

      const body = JSON.parse(fetchOptions.body);
      expect(body.event).toBe("playing");
      // Reporter uses its authoritative sessionId (from server init response)
      expect(body.sessionId).toBe("server-generated-id");
      expect(body.playhead).toBe(10.5);
    });

    it("should include shardId in payload when provided", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
        shardId: "shard-123",
      };
      const reporter = new Reporter(options);
      await reporter.init();

      mockFetch.calls.reset();

      const eventData: TPlayerAnalyticsEvent = {
        event: "playing",
        sessionId: "test-session-id",
        timestamp: 1234567890,
        playhead: 10.5,
        duration: 120,
      };

      reporter.send(eventData);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.shardId).toBe("shard-123");
    });

    it("should log to console in debug mode instead of calling fetch", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "debug-session-id",
        debug: true,
      };
      const reporter = new Reporter(options);

      spyOn(console, "log");
      await reporter.init();

      mockFetch.calls.reset();

      const eventData: TPlayerAnalyticsEvent = {
        event: "playing",
        sessionId: "debug-session-id",
        timestamp: 1234567890,
        playhead: 10.5,
        duration: 120,
      };

      reporter.send(eventData);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it("should warn on network failure in non-debug mode", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
        debug: true,
      };
      const reporter = new Reporter(options);
      await reporter.init();

      // Switch to non-debug mode and make fetch fail
      (reporter as any).debug = false;
      mockFetch.calls.reset();
      mockFetch.and.returnValue(Promise.reject(new Error("Network failure")));

      spyOn(console, "warn");

      const eventData: TPlayerAnalyticsEvent = {
        event: "playing",
        sessionId: "test-session-id",
        timestamp: 1234567890,
        playhead: 10.5,
        duration: 120,
      };

      reporter.send(eventData);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        "[AnalyticsReporter] Send failed:", "Network failure"
      );
    });

    it("should warn on HTTP error response (e.g. 404)", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
        debug: true,
      };
      const reporter = new Reporter(options);
      await reporter.init();

      (reporter as any).debug = false;
      mockFetch.calls.reset();
      mockFetch.and.returnValue(Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }));

      spyOn(console, "warn");

      reporter.send({
        event: "heartbeat",
        sessionId: "test-session-id",
        timestamp: 1234567890,
        playhead: 30,
        duration: 120,
      } as TPlayerAnalyticsEvent);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(console.warn).toHaveBeenCalledWith(
        "[AnalyticsReporter] Send failed: 404 Not Found"
      );
    });

    it("should warn and not send when not initiated", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
      };
      const reporter = new Reporter(options);
      // Note: NOT calling init()

      spyOn(console, "warn");

      const eventData: TPlayerAnalyticsEvent = {
        event: "playing",
        sessionId: "test-session-id",
        timestamp: 1234567890,
        playhead: 10.5,
        duration: 120,
      };

      reporter.send(eventData);

      expect(console.warn).toHaveBeenCalledWith(
        "[AnalyticsReporter] Cannot report before initiation:",
        eventData
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("event queuing during init", () => {
    it("should queue events sent while init is in flight", async () => {
      let resolveInit: (value: any) => void;
      const pendingInit = new Promise((resolve) => { resolveInit = resolve; });
      mockFetch.and.returnValue(pendingInit);

      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
      };
      const reporter = new Reporter(options);

      // Start init but don't resolve yet
      const initPromise = reporter.init();
      mockFetch.calls.reset();

      // Send events while init is in flight
      const event1: TPlayerAnalyticsEvent = {
        event: "playing",
        sessionId: "test-session-id",
        timestamp: 1000,
        playhead: 0,
        duration: 120,
      };
      const event2: TPlayerAnalyticsEvent = {
        event: "heartbeat",
        sessionId: "test-session-id",
        timestamp: 2000,
        playhead: 10,
        duration: 120,
      };

      reporter.send(event1);
      reporter.send(event2);

      // Events should be queued, not dispatched
      expect(mockFetch).not.toHaveBeenCalled();

      // Now resolve init
      resolveInit!({
        ok: true,
        json: () => Promise.resolve({ sessionId: "server-session-id" }),
        statusText: "OK",
      });

      await initPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both events should now have been flushed
      expect(mockFetch.calls.count()).toBe(2);

      // Verify events flushed in order
      const body1 = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body1.event).toBe("playing");
      const body2 = JSON.parse(mockFetch.calls.argsFor(1)[1].body);
      expect(body2.event).toBe("heartbeat");
    });

    it("should patch queued events with server sessionId on flush", async () => {
      let resolveInit: (value: any) => void;
      const pendingInit = new Promise((resolve) => { resolveInit = resolve; });
      mockFetch.and.returnValue(pendingInit);

      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        // No client sessionId provided
      };
      const reporter = new Reporter(options);
      const initPromise = reporter.init();
      mockFetch.calls.reset();

      reporter.send({
        event: "loading",
        sessionId: undefined,
        timestamp: 1000,
        playhead: -1,
        duration: -1,
      } as TPlayerAnalyticsEvent);

      // Resolve init with server-generated sessionId
      resolveInit!({
        ok: true,
        json: () => Promise.resolve({ sessionId: "server-generated-id" }),
        statusText: "OK",
      });

      await initPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockFetch.calls.count()).toBe(1);
      const body = JSON.parse(mockFetch.calls.argsFor(0)[1].body);
      expect(body.sessionId).toBe("server-generated-id");
    });

    it("should discard queued events if init fails", async () => {
      mockFetch.and.returnValue(Promise.resolve({
        ok: false,
        statusText: "Internal Server Error",
      }));

      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
      };
      const reporter = new Reporter(options);

      // Start init (will fail) — queue an event during the microtask gap
      const initPromise = reporter.init();

      // Manually set state to test the failed path
      reporter.send({
        event: "playing",
        sessionId: "test-session-id",
        timestamp: 1000,
        playhead: 0,
        duration: 120,
      } as TPlayerAnalyticsEvent);

      try {
        await initPromise;
      } catch (e) {
        // Expected
      }

      // After failure, send should warn
      mockFetch.calls.reset();
      spyOn(console, "warn");

      reporter.send({
        event: "heartbeat",
        sessionId: "test-session-id",
        timestamp: 2000,
        playhead: 10,
        duration: 120,
      } as TPlayerAnalyticsEvent);

      expect(console.warn).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should not allow double init", async () => {
      const options: IReporterOptions = {
        eventsinkUrl: "https://example.com/analytics",
        sessionId: "test-session-id",
        debug: true,
      };
      const reporter = new Reporter(options);

      const result1 = await reporter.init();
      const result2 = await reporter.init();

      // Second call should return same promise/result
      expect(result1.sessionId).toBe(result2.sessionId);
    });
  });
});
