// src/sgai-ad-tracking-extractor.ts
import { SGAIAdTrackingEvent } from "./sgai-ad-tracking-events";

type AdResponse = {
  ASSETS: Array<{
    URI: string;
    DURATION?: number;
    "X-AD-CREATIVE-SIGNALING"?: { payload: { tracking: AdTrackingEvent[] } };
  }>;
  "X-AD-CREATIVE-SIGNALING"?: { payload: { tracking?: AdTrackingEvent[] } };
};
type AdTrackingEvent = { type: string; urls: string[] };

export class SGAIAdTrackingUrlsExtractor {
  private map: Record<string, Record<string, string[]>> = {};
  currentAdsId = "ad-session-1";
  private podCallbacks: Array<(eventType: string, podId: string) => void> = [];

  onPodEvent(cb: (eventType: string, podId: string) => void) {
    this.podCallbacks.push(cb);
  }

  async extract(assetListUrl: string, adBreakId: string): Promise<boolean> {
    try {
      const res = await fetch(assetListUrl, { cache: "no-store" });
      const json = (await res.json()) as AdResponse;

      // Pod-level tracking (X-AD-CREATIVE-SIGNALING at top)
      const podTracking = json["X-AD-CREATIVE-SIGNALING"]?.payload?.tracking ?? [];
      const podMap = this.groupByType(podTracking);
      if (Object.keys(podMap).length) {
        const podKey = `pod_${adBreakId}`;
        this.map[podKey] = podMap;
        this.triggerPodEvent(SGAIAdTrackingEvent.POD_START, podKey);
      }

      // Per-ad tracking
      json.ASSETS.forEach((ad, index) => {
        const key = `${this.currentAdsId}_0_${index}`;
        const tracking = ad["X-AD-CREATIVE-SIGNALING"]?.payload?.tracking ?? [];
        const grouped = this.groupByType(tracking);
        if (Object.keys(grouped).length) this.map[key] = grouped;
      });

      return true;
    } catch {
      return false;
    }
  }

  getTrackingForAd(adKey: string) {
    return this.map[adKey];
  }
  getAll() {
    return { ...this.map };
  }

  sendPodEnd(podId: string, send: (url: string) => void) {
    const urls = this.map[podId]?.[SGAIAdTrackingEvent.POD_END] ?? [];
    urls.forEach(send);
    this.triggerPodEvent(SGAIAdTrackingEvent.POD_END, podId);
  }

  private triggerPodEvent(type: SGAIAdTrackingEvent, podId: string) {
    this.podCallbacks.forEach(cb => cb(type, podId));
  }
  private groupByType(events: AdTrackingEvent[]) {
    return events
      .filter(e => Array.isArray(e.urls) && e.urls.length)
      .reduce<Record<string, string[]>>((acc, e) => {
        acc[e.type] = (acc[e.type] ?? []).concat(e.urls);
        return acc;
      }, {});
  }
}
