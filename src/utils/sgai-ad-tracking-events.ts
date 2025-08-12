// src/sgai-ad-tracking-events.ts
export enum SGAIAdTrackingEvent {
  IMPRESSION = "impression",
  START = "start",
  FIRST_QUARTILE = "firstQuartile",
  MIDPOINT = "midpoint",
  THIRD_QUARTILE = "thirdQuartile",
  COMPLETE = "complete",
  PAUSE = "pause",
  RESUME = "resume",
  POD_START = "podStart",
  POD_END = "podEnd",
}

export function normalizeEventName(eventName: string): string {
  const e = eventName.toLowerCase();
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
  const e = eventType.toLowerCase();
  if (e === "impression" || e === "firstquartile") return "start";
  if (e === "thirdquartile") return "complete";
  return eventType;
}
