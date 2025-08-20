import {
  SGAIEvent,
  type TrackingEvent,
  type TrackingData,
  type TrackingMap,
} from "./SGAITracking";
import { SGAIAdImpressionSender } from "./SGAIAdImpressionSender";

export class SGAIAdTrackingUrlsExtractor {
  private map: TrackingMap = {};
  private currentAdsId = "ad-session-1";
  private podCallbacks: ((type: string, podId: string) => void)[] = [];

  constructor(adsSessionId?: string) {
    if (adsSessionId) {
      this.currentAdsId = adsSessionId;
    }
    console.log(
      "[SGAI] Tracking extractor initialized with session:",
      this.currentAdsId
    );
  }

  onPodEvent(cb: (type: string, podId: string) => void): void {
    if (typeof cb === "function") {
      this.podCallbacks.push(cb);
    }
  }

  private triggerPodEvent(type: string, podId: string): void {
    console.log("[SGAI] Triggering pod event:", type, podId);
    this.podCallbacks.forEach((cb) => cb(type, podId));
  }

  private groupByType(events: TrackingEvent[]): TrackingData {
    console.log("[SGAI] Grouping tracking events:", events);
    const grouped = (events || [])
      .filter((e: TrackingEvent) => {
        const hasUrls = Array.isArray(e.urls) && e.urls.length;
        console.log("[SGAI] Event:", e?.type, "has urls:", hasUrls, e?.urls);
        return hasUrls;
      })
      .reduce((acc: TrackingData, e: TrackingEvent) => {
        const t = String(e.type || "");
        acc[t] = (acc[t] || []).concat(e.urls);
        acc[t.toLowerCase()] = acc[t.toLowerCase()] || acc[t];
        return acc;
      }, {});
    console.log("[SGAI] Grouped tracking events (canonical + lowercased keys):", grouped);
    return grouped;
  }

  async extract(assetListUrl: string, adBreakId: string) {
    console.log("[SGAI] Extracting from asset list:", assetListUrl, "for break:", adBreakId);
    try {
      const res = await fetch(assetListUrl, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!res.ok) {
        console.error("[SGAI] Failed to fetch asset list:", res.status, res.statusText);
        return { ok: false, adUris: [] };
      }

      const json: any = await res.json();
      console.log("[SGAI] Asset list response:", json);

      const podTracking: TrackingEvent[] = json?.["X-AD-CREATIVE-SIGNALING"]?.payload?.tracking || [];
      console.log("[SGAI] Pod-level tracking:", podTracking);

      const podMap = this.groupByType(podTracking);
      if (Object.keys(podMap).length) {
        const podKey = `pod_${adBreakId}`;
        this.map[podKey] = podMap;
        console.log("[SGAI] Stored pod tracking for key:", podKey, podMap);
        this.triggerPodEvent(SGAIEvent.POD_START, podKey);
      }

      const assets: any[] = json?.ASSETS || [];
      console.log("[SGAI] Processing", assets.length, "assets");

      assets.forEach((ad: any, index: number) => {
        console.log("[SGAI] Processing asset", index, ":", ad);
        const tracking: TrackingEvent[] = ad?.["X-AD-CREATIVE-SIGNALING"]?.payload?.tracking || [];
        console.log("[SGAI] Asset", index, "tracking:", tracking);

        const grouped = this.groupByType(tracking);
        if (Object.keys(grouped).length) {
          const key = `${this.currentAdsId}_0_${index}`;
          this.map[key] = grouped;
          console.log("[SGAI] Stored ad tracking for key:", key, grouped);
        }
      });

      const adUris: string[] = assets.map((a: any) => a.URI).filter(Boolean);
      console.log("[SGAI] Extracted ad URIs:", adUris);
      console.log("[SGAI] Complete tracking map:", this.map);

      return { ok: true, adUris };
    } catch (e) {
      console.error("[SGAI] Asset list fetch failed:", e);
      return { ok: false, adUris: [] };
    }
  }

  getTrackingForAd(adKey: string) { return this.map[adKey]; }
  getAll() { return Object.assign({}, this.map); }

  sendPodEnd(podId: string, sender: SGAIAdImpressionSender): void {
    const urls = (this.map[podId]?.[SGAIEvent.POD_END] || this.map[podId]?.[SGAIEvent.POD_END.toLowerCase()]) || [];
    console.log("[SGAI] Sending pod end for:", podId, "URLs:", urls);
    (urls || []).forEach((u: string) =>
      sender.fire(u, SGAIEvent.POD_END, podId)
    );
    this.triggerPodEvent(SGAIEvent.POD_END, podId);
  }

  clear(): void {
    this.map = {};
  }
  setAdsSessionId(sessionId: string): void { this.currentAdsId = sessionId; }
}
