// src/video-analytics-tracker-web.ts
import { SGAIAdImpressionSender } from "./sgai-ad-impression-sender";
import { SGAIAdTrackingUrlsExtractor } from "./sgai-ad-tracking-extractor";
import { SGAIAdTrackingEvent, normalizeEventName, mapEventName } from "./sgai-ad-tracking-events";

type TrackerCfg = {
  heartbeatIntervalMs?: number;
  enableSGAITracking?: boolean;
};

export class VideoAnalyticsTrackerWeb {
  private extractor = new SGAIAdTrackingUrlsExtractor();
  private sender = new SGAIAdImpressionSender();
  private heartbeatTimer: number | null = null;
  private progressTimer: number | null = null;
  private lastQuartile = 0;
  private currentAdKey: string | null = null;
  private sent: Record<string, Set<string>> = {};
  private activePods = new Set<string>();

  constructor(private video: HTMLVideoElement, private cfg: TrackerCfg = {}) {
    this.cfg.heartbeatIntervalMs ??= 30_000;
    this.cfg.enableSGAITracking ??= true;
    this.installVideoListeners();
    this.extractor.onPodEvent((type, podKey) => {
      if (type === SGAIAdTrackingEvent.POD_START) this.activePods.add(podKey);
      if (type === SGAIAdTrackingEvent.POD_END) this.activePods.delete(podKey);
    });
  }

  /** Call this when you detect an interstitial ad break and get its Asset List URL. */
  async onAssetList(assetListUrl: string, adBreakId: string) {
    const ok = await this.extractor.extract(assetListUrl, adBreakId); // Android: extractTrackingUrls(...) :contentReference[oaicite:4]{index=4}
    if (ok) {
      // Initialize sent map for all discovered ads
      Object.keys(this.extractor.getAll()).forEach(k => (this.sent[k] ??= new Set()));
    }
  }

  /** Call when an individual ad actually starts (group/index known). */
  onAdStart(adGroupIndex: number, adIndexInGroup: number) {
    this.currentAdKey = `ad-session-1_${adGroupIndex}_${adIndexInGroup}`;
    this.lastQuartile = 0;

    // First ad in pod? fire podStart (extractor already did, but keep parity)
    if (adIndexInGroup === 0) {
      const podKey = `pod_ad-session-1_${adGroupIndex}`;
      this.activePods.add(podKey);
      this.sendPodEvent(podKey, SGAIAdTrackingEvent.POD_START);
    }

    // Impression + start
    this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.IMPRESSION);
    this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.START);

    this.startAdProgress();
  }

  /** Call when the current ad completes. */
  onAdComplete(adGroupIndex: number, adIndexInGroup: number) {
    const key = `ad-session-1_${adGroupIndex}_${adIndexInGroup}`;
    this.fireAdEvent(key, SGAIAdTrackingEvent.COMPLETE);
    this.stopAdProgress();

    // If that was the last ad in group (you must know the count), close pod:
    const podKey = `pod_ad-session-1_${adGroupIndex}`;
    if (this.activePods.has(podKey)) {
      this.sendPodEvent(podKey, SGAIAdTrackingEvent.POD_END);
      this.activePods.delete(podKey);
      // also relay extractor pod end URLs, like Android: sendPodEndTracking(...) :contentReference[oaicite:5]{index=5}
      const urls = this.extractor.getTrackingForAd(podKey)?.[SGAIAdTrackingEvent.POD_END] ?? [];
      this.sender.sendMultiple(urls, SGAIAdTrackingEvent.POD_END, podKey);
    }
  }

  onAdPause() {
    if (this.currentAdKey) this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.PAUSE, false);
  }
  onAdResume() {
    if (this.currentAdKey) this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.RESUME, false);
  }

  /** Hook up basic content analytics as needed (heartbeat etc.) */
  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = window.setInterval(() => {
      // send your content heartbeat here if desired
    }, this.cfg.heartbeatIntervalMs);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** ===== Internals ===== */

  private installVideoListeners() {
    // If you’re driving ads via your own timeline events, call onAdStart/onAdComplete from there.
    // These handlers help pause/resume parity like Android’s onIsPlayingChanged logic. :contentReference[oaicite:6]{index=6}
    this.video.addEventListener("pause", () => this.onAdPause());
    this.video.addEventListener("play", () => this.onAdResume());
  }

  private startAdProgress() {
    if (this.progressTimer) return;
    this.progressTimer = window.setInterval(() => this.trackQuartiles(), 250); // 250ms like Android handler loop :contentReference[oaicite:7]{index=7}
  }
  private stopAdProgress() {
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
    this.lastQuartile = 0;
  }

  private trackQuartiles() {
    if (!this.currentAdKey) return;
    const d = this.video.duration;
    const t = this.video.currentTime;
    if (!(d > 0 && t >= 0)) return;

    const p = t / d;
    const q = p >= 0.75 ? 3 : p >= 0.5 ? 2 : p >= 0.25 ? 1 : 0;
    if (q > this.lastQuartile) {
      if (q === 1) this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.FIRST_QUARTILE);
      if (q === 2) this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.MIDPOINT);
      if (q === 3) this.fireAdEvent(this.currentAdKey, SGAIAdTrackingEvent.THIRD_QUARTILE); // Android mirrors this logic :contentReference[oaicite:8]{index=8}
      this.lastQuartile = q;
    }
  }

  private sendPodEvent(podKey: string, type: SGAIAdTrackingEvent) {
    const urls = this.extractor.getTrackingForAd(podKey)?.[type] ?? [];
    if (urls.length) this.sender.sendMultiple(urls, type, podKey);
  }

  private fireAdEvent(adKey: string, type: SGAIAdTrackingEvent, dedupe = true) {
    const all = this.extractor.getAll(); // Android checks keys + mapped keys, then sends via impression sender :contentReference[oaicite:9]{index=9}
    const mappedAdKey =
      Object.keys(all).find(k => k.includes(adKey)) ??
      Object.keys(all).length === 1 ? Object.keys(all)[0] : adKey;

    const triedKeys = [
      type,
      normalizeEventName(type),
      mapEventName(type),
      normalizeEventName(mapEventName(type)),
    ];
    let urls: string[] = [];
    for (const k of triedKeys) {
      urls = all[mappedAdKey]?.[k] ?? [];
      if (urls.length) break;
    }

    if (!urls.length) return;
    if (dedupe) {
      this.sent[mappedAdKey] ??= new Set();
      if (this.sent[mappedAdKey].has(type)) return;
      if (type !== SGAIAdTrackingEvent.PAUSE && type !== SGAIAdTrackingEvent.RESUME) {
        this.sent[mappedAdKey].add(type);
      }
    }
    this.sender.sendMultiple(urls, type, adKey);
  }
}
