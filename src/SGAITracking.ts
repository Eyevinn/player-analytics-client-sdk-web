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

export function normalizeEventName(eventName: string): string {
  const e = String(eventName || "").toLowerCase();
  switch (e) {
    case "podstart":
    case "pod_start": return SGAIEvent.POD_START;
    case "podend":
    case "pod_end": return SGAIEvent.POD_END;
    case "firstquartile":
    case "first_quartile": return SGAIEvent.FIRST_QUARTILE;
    case "midpoint":
    case "mid_point": return SGAIEvent.MIDPOINT;
    case "thirdquartile":
    case "third_quartile": return SGAIEvent.THIRD_QUARTILE;
    default: return e;
  }
}

export { SGAIAdImpressionSender } from "./SGAIAdImpressionSender";
export { SGAIAdTracker } from "./SGAIAdTracker";
export { SGAIAdTrackingUrlsExtractor } from "./SGAIAdTrackingUrlsExtractor";
