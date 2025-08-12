// src/sgai-ad-impression-sender.ts
import { SGAIAdTrackingEvent } from "./sgai-ad-tracking-events";

export class SGAIAdImpressionSender {
  private sessionId = crypto.randomUUID();
  constructor(private userAgent = "SGAI-AdTracker-Web/1.0") {}

  sendMultiple(urls: string[], event: SGAIAdTrackingEvent, adKey: string) {
    urls.forEach(u => this.fire(u, event, adKey));
  }

  private async fire(url: string, event: SGAIAdTrackingEvent, adKey: string) {
    try {
      const decoded = decodeURIComponent(url);
      // Prefer sendBeacon for reliability; fallback to fetch no-cors GET
      const ok = "sendBeacon" in navigator &&
        navigator.sendBeacon(decoded, new Blob([], { type: "application/octet-stream" }));

      if (!ok) {
        await fetch(decoded, {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
          keepalive: true,
          headers: {
            "X-Session-ID": this.sessionId,
            "X-Ad-Key": adKey,
            "X-Event-Type": event,
          },
        });
      }
      // (No console.log in production; add debug flag if desired)
    } catch (e) {
      // Swallow errors to avoid impacting playback
      // console.warn("Ad pixel failed", e);
    }
  }
}
