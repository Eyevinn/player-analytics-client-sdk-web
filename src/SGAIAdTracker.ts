import { SGAIAdTrackingUrlsExtractor } from "./SGAIAdTrackingUrlsExtractor";
import { SGAIAdImpressionSender } from "./SGAIAdImpressionSender";
import {
  SGAIEventType,
  SGAIEvent,
  normalizeEventName,
  TrackingData,
} from "./SGAITracking";

export class SGAIAdTracker {
  public extractor: SGAIAdTrackingUrlsExtractor;
  public sender: SGAIAdImpressionSender;

  constructor(adsSessionId?: string) {
    this.extractor = new SGAIAdTrackingUrlsExtractor(adsSessionId);
    this.sender = new SGAIAdImpressionSender();
  }

  async sendAdEvent(adKey: string, eventType: SGAIEventType): Promise<void> {
    console.log("[SGAI] === SEND AD EVENT ===");
    console.log("[SGAI] Ad Key:", adKey);
    console.log("[SGAI] Event Type:", eventType);

    const all = this.extractor.getAll();
    console.log("[SGAI] All available tracking data keys:", Object.keys(all));

    let trackingData: TrackingData | undefined = null;
    let mappedKey = adKey;

    if (all[adKey]) {
      trackingData = all[adKey];
    } else {
      const availableKeys = Object.keys(all);
      if (availableKeys.length > 0) {
        mappedKey = availableKeys[0];
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

    const availableKeys = Object.keys(trackingData);
    console.log("[SGAI] Available event keys:", availableKeys);

    let eventToFind = eventType;
    if (eventType === SGAIEvent.IMPRESSION && !availableKeys.some((k) => k.toLowerCase().includes('impression'))) {
      console.log("[SGAI] No impression URLs found, mapping to start event");
      eventToFind = SGAIEvent.START;
    }

    const tries = [
      String(eventToFind || ""),
      normalizeEventName(eventToFind),
      String(eventToFind || "").toLowerCase(),
      normalizeEventName(eventToFind).toLowerCase(),
    ];

    console.log("[SGAI] Trying event variations (in order):", tries);

    let urls: string[] = [];
    let foundEventType: string | null = null;

    for (let i = 0; i < tries.length && urls.length === 0; i++) {
      const tk = tries[i];
      let matchKey = availableKeys.find((k) => k.toLowerCase() === String(tk || "").toLowerCase());

      if (!matchKey && tk) {
        matchKey = availableKeys.find((k) =>
          k.toLowerCase().includes(String(tk).toLowerCase())
        );
      }
      if (matchKey) {
        urls = trackingData[matchKey] || [];
        foundEventType = matchKey;
      }
      console.log(
        "[SGAI] Try",
        i + 1,
        "- try:",
        tk,
        "=> matchKey:",
        matchKey,
        "urlsFound:",
        urls.length
      );
    }

    if (urls.length) {
      console.log("[SGAI] Sending tracking pixels for:", foundEventType);
      console.log("[SGAI] URLs to fire:", urls);
      this.sender.sendMultiple(urls, eventType, mappedKey);
    } else {
      console.error("[SGAI] NO TRACKING URLS FOUND for event:", eventType);
      console.log("[SGAI] Available events:", availableKeys);
    }
  }
}