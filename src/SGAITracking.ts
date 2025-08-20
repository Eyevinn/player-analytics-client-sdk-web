export interface TrackingEvent {
  type: string;
  urls: string[];
}

export interface AssetListResponse {
  ok: boolean;
  adUris: string[];
}

export interface TrackingData {
  [eventType: string]: string[];
}

export interface TrackingMap {
  [adKey: string]: TrackingData;
}

export const SGAIEvent = {
  IMPRESSION: "impression",
  START: "start",
  FIRST_QUARTILE: "firstQuartile",
  MIDPOINT: "midpoint",
  THIRD_QUARTILE: "thirdQuartile",
  COMPLETE: "complete",
  PAUSE: "pause",
  RESUME: "resume",
  POD_START: "podStart",
  POD_END: "podEnd",
} as const;

export type SGAIEventType = typeof SGAIEvent[keyof typeof SGAIEvent];

// Normalizers (Android/Web parity)
export function normalizeEventName(eventName: string): string {
  const e = String(eventName || "").toLowerCase();
  switch (e) {
    case "podstart":
    case "pod_start":
      return "podStart";
    case "podend":
    case "pod_end":
      return "podEnd";
    case "firstquartile":
    case "first_quartile":
      return "firstQuartile";
    case "midpoint":
    case "mid_point":
      return "midpoint";
    case "thirdquartile":
    case "third_quartile":
      return "thirdQuartile";
    default:
      return e;
  }
}

export function mapEventName(eventType: string): string {
  const e = String(eventType || "").toLowerCase();
  if (e === "impression" || e === "firstquartile") return "start";
  if (e === "thirdquartile") return "complete";
  return eventType;
}

/**
 * Handles sending tracking pixels using sendBeacon with fetch fallback
 */
export class SGAIAdImpressionSender {
  private sessionId: string;

  constructor() {
    this.sessionId = (crypto && crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    console.log("[SGAI] Impression sender initialized with session:", this.sessionId);
  }

  /**
   * Fire a single tracking pixel
   */
  async fire(url: string, eventType: string, adKey: string): Promise<void> {
    console.log("[SGAI] Firing tracking pixel:", { url, eventType, adKey });
    try {
      const decoded = decodeURIComponent(url);
      console.log("[SGAI] Decoded URL:", decoded);

      const ok =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(decoded, new Blob([], { type: "application/octet-stream" }));

      if (ok) {
        console.log("[SGAI] Sent via sendBeacon:", decoded);
      } else {
        console.log("[SGAI] Fallback to fetch:", decoded);
        await fetch(decoded, {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
          keepalive: true,
          headers: {
            "X-Session-ID": this.sessionId,
            "X-Ad-Key": adKey || "",
            "X-Event-Type": eventType || "",
          },
        }).catch((e) => {
          // fetch with no-cors will often reject or return opaque response – treat failures gracefully
          console.warn("[SGAI] fetch (no-cors) error (expected for opaque endpoints):", e);
        });
      }
    } catch (e) {
      console.error("[SGAI] Failed to send tracking pixel:", e);
    }
  }

  /**
   * Send multiple tracking pixels for the same event
   */
  sendMultiple(urls: string[], eventType: string, adKey: string): void {
    console.log("[SGAI] Sending multiple tracking pixels:", { urls, eventType, adKey });
    (urls || []).forEach((u) => this.fire(u, eventType, adKey));
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Extracts and manages tracking URLs from asset lists for HLS interstitial ads
 */
export class SGAIAdTrackingUrlsExtractor {
  private map: TrackingMap = {}; // { adKey|podKey: { eventType: [urls] } }
  private currentAdsId: string = "ad-session-1";
  private podCallbacks: ((type: string, podId: string) => void)[] = []; // listeners for podStart/podEnd

  constructor(adsSessionId?: string) {
    if (adsSessionId) {
      this.currentAdsId = adsSessionId;
    }
    console.log("[SGAI] Tracking extractor initialized with session:", this.currentAdsId);
  }

  /**
   * Register a callback for pod events (podStart/podEnd)
   */
  onPodEvent(cb: (type: string, podId: string) => void): void {
    if (typeof cb === "function") this.podCallbacks.push(cb);
  }

  /**
   * Trigger pod event callbacks
   */
  private triggerPodEvent(type: string, podId: string): void {
    console.log("[SGAI] Triggering pod event:", type, podId);
    this.podCallbacks.forEach((cb) => cb(type, podId));
  }

  /**
   * Group tracking events by type
   */
  private groupByType(events: TrackingEvent[]): TrackingData {
    console.log("[SGAI] Grouping tracking events:", events);
    const grouped = (events || [])
      .filter((e) => {
        const hasUrls = Array.isArray(e.urls) && e.urls.length;
        console.log("[SGAI] Event:", e && e.type, "has urls:", hasUrls, e && e.urls);
        return hasUrls;
      })
      .reduce((acc: TrackingData, e) => {
        const t = String(e.type || "");
        // store canonical + lowercased key
        acc[t] = (acc[t] || []).concat(e.urls);
        acc[t.toLowerCase()] = acc[t.toLowerCase()] || acc[t];
        return acc;
      }, {});
    console.log("[SGAI] Grouped tracking events (canonical + lowercased keys):", grouped);
    return grouped;
  }

  /**
   * Extract tracking data from an asset list URL
   */
  async extract(assetListUrl: string, adBreakId: string): Promise<AssetListResponse> {
    console.log("[SGAI] Extracting from asset list:", assetListUrl, "for break:", adBreakId);
    try {
      const res = await fetch(assetListUrl, {
        cache: "no-store",
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        console.error("[SGAI] Failed to fetch asset list:", res.status, res.statusText);
        return { ok: false, adUris: [] };
      }

      const json = await res.json();
      console.log("[SGAI] Asset list response:", json);

      // pod-level tracking
      const podTracking: TrackingEvent[] = json && json["X-AD-CREATIVE-SIGNALING"] && json["X-AD-CREATIVE-SIGNALING"].payload
        ? (json["X-AD-CREATIVE-SIGNALING"].payload.tracking || [])
        : [];
      console.log("[SGAI] Pod-level tracking:", podTracking);

      const podMap = this.groupByType(podTracking);
      if (Object.keys(podMap).length) {
        const podKey = "pod_" + adBreakId;
        this.map[podKey] = podMap;
        console.log("[SGAI] Stored pod tracking for key:", podKey, podMap);
        this.triggerPodEvent(SGAIEvent.POD_START, podKey);
      }

      // per-ad tracking
      const assets: any[] = (json && json.ASSETS) || [];
      console.log("[SGAI] Processing", assets.length, "assets");

      assets.forEach((ad, index) => {
        console.log("[SGAI] Processing asset", index, ":", ad);
        const tracking: TrackingEvent[] = ad && ad["X-AD-CREATIVE-SIGNALING"] && ad["X-AD-CREATIVE-SIGNALING"].payload
          ? (ad["X-AD-CREATIVE-SIGNALING"].payload.tracking || [])
          : [];
        console.log("[SGAI] Asset", index, "tracking:", tracking);

        const grouped = this.groupByType(tracking);
        if (Object.keys(grouped).length) {
          const key = this.currentAdsId + "_0_" + index;
          this.map[key] = grouped;
          console.log("[SGAI] Stored ad tracking for key:", key, grouped);
        }
      });

      // Return creative URIs in order for playback
      const adUris: string[] = assets.map((a) => a.URI).filter(Boolean);
      console.log("[SGAI] Extracted ad URIs:", adUris);
      console.log("[SGAI] Complete tracking map:", this.map);

      return { ok: true, adUris };
    } catch (e) {
      console.error("[SGAI] Asset list fetch failed:", e);
      return { ok: false, adUris: [] };
    }
  }

  /**
   * Get tracking data for a specific ad key
   */
  getTrackingForAd(adKey: string): TrackingData | undefined {
    const tracking = this.map[adKey];
    console.log("[SGAI] Getting tracking for ad key:", adKey, "->", tracking);
    return tracking;
  }

  /**
   * Get all tracking data
   */
  getAll(): TrackingMap {
    console.log("[SGAI] All tracking data:", this.map);
    return Object.assign({}, this.map);
  }

  /**
   * Send pod end tracking pixels
   */
  sendPodEnd(podId: string, sender: SGAIAdImpressionSender): void {
    const urls = (this.map[podId] && (this.map[podId][SGAIEvent.POD_END] || this.map[podId][SGAIEvent.POD_END.toLowerCase()])) || [];
    console.log("[SGAI] Sending pod end for:", podId, "URLs:", urls);
    (urls || []).forEach((u) => sender.fire(u, SGAIEvent.POD_END, podId));
    this.triggerPodEvent(SGAIEvent.POD_END, podId);
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.map = {};
    console.log("[SGAI] Cleared all tracking data");
  }

  /**
   * Set the current ads session ID
   */
  setAdsSessionId(sessionId: string): void {
    this.currentAdsId = sessionId;
    console.log("[SGAI] Updated ads session ID to:", sessionId);
  }
}

/**
 * Utility class that combines both tracking extractor and impression sender
 * for easier integration
 */
export class SGAIAdTracker {
  public extractor: SGAIAdTrackingUrlsExtractor;
  public sender: SGAIAdImpressionSender;

  constructor(adsSessionId?: string) {
    this.extractor = new SGAIAdTrackingUrlsExtractor(adsSessionId);
    this.sender = new SGAIAdImpressionSender();
  }

  /**
   * Send an ad event by finding the appropriate tracking URLs
   */
  async sendAdEvent(adKey: string, eventType: SGAIEventType): Promise<void> {
    console.log("[SGAI] === SEND AD EVENT ===");
    console.log("[SGAI] Ad Key:", adKey);
    console.log("[SGAI] Event Type:", eventType);

    const all = this.extractor.getAll();
    console.log("[SGAI] All available tracking data keys:", Object.keys(all));

    // Better key mapping logic
    let trackingData: TrackingData | undefined = null;
    let mappedKey = adKey;

    // Try exact match first
    if (all[adKey]) {
      trackingData = all[adKey];
    } else {
      // Find any tracking data (since all ads use the same tracking URLs)
      const availableKeys = Object.keys(all);
      if (availableKeys.length > 0) {
        mappedKey = availableKeys[0]; // Use the first available key
        trackingData = all[mappedKey];
        console.log("[SGAI] Using fallback key:", mappedKey);
      }
    }

    console.log("[SGAI] Mapped key:", mappedKey);
    console.log("[SGAI] Tracking data:", trackingData);

    if (!trackingData) {
      console.error("[SGAI] NO TRACKING DATA FOUND for ad");
      return;
    }

    const availableKeys = Object.keys(trackingData || {});
    console.log("[SGAI] Available event keys:", availableKeys);

    // Enhanced event mapping - map impression to start if no impression URLs
    let eventToFind = eventType;
    if (eventType === 'impression' && !availableKeys.some(k => k.toLowerCase().includes('impression'))) {
      console.log("[SGAI] No impression URLs found, mapping to start event");
      eventToFind = 'start';
    }

    const tries = [
      String(eventToFind || ""),
      normalizeEventName(eventToFind),
      String(eventToFind || "").toLowerCase(),
      normalizeEventName(eventToFind).toLowerCase()
    ];

    console.log("[SGAI] Trying event variations (in order):", tries);

    let urls: string[] = [];
    let foundEventType: string | null = null;

    for (let i = 0; i < tries.length && urls.length === 0; i++) {
      const tk = tries[i];
      let matchKey = availableKeys.find(k => k.toLowerCase() === String(tk || "").toLowerCase());

      if (!matchKey && tk) {
        matchKey = availableKeys.find(k => k.toLowerCase().includes(String(tk).toLowerCase()));
      }
      if (matchKey) {
        urls = trackingData[matchKey] || [];
        foundEventType = matchKey;
      }
      console.log("[SGAI] Try", i + 1, "- try:", tk, "=> matchKey:", matchKey, "urlsFound:", urls.length);
    }

    if (urls.length) {
      console.log("[SGAI] ✅ Sending tracking pixels for:", foundEventType);
      console.log("[SGAI] ✅ URLs to fire:", urls);
      this.sender.sendMultiple(urls, eventType, mappedKey);
    } else {
      console.error("[SGAI] ❌ NO TRACKING URLS FOUND for event:", eventType);
      console.log("[SGAI] Available events:", availableKeys);
    }
  }
}