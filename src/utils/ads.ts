import { SGAIEvent } from "../SGAITracking";

export function buildAdKey(sessionId: string, index: number | string): string {
  return `${sessionId}_0_${String(index)}`;
}

export function resolveAssetIndex(evt: any, fallbackSeq: () => number): number {
  let idx = Number(evt?.index);
  if (!Number.isFinite(idx)) {
    const asNum = Number(evt?.assetId ?? evt?.id);
    idx = Number.isFinite(asNum) ? asNum : fallbackSeq();
  }
  return idx;
}

/**
 * Schedules FIRST_QUARTILE / MIDPOINT / THIRD_QUARTILE timeouts and returns a canceller.
 * If durationSec is falsy, returns a no-op canceller.
 */
export function scheduleQuartiles(durationSec: number, handler: (event: SGAIEvent) => void): () => void {
  const timers: number[] = [];
  const ms = Math.max(0, Number(durationSec || 0) * 1000);
  if (!ms) return () => {};

  const q = (p: number, e: SGAIEvent) => timers.push(window.setTimeout(() => handler(e), ms * p));
  q(0.25, SGAIEvent.FIRST_QUARTILE);
  q(0.50, SGAIEvent.MIDPOINT);
  q(0.75, SGAIEvent.THIRD_QUARTILE);

  return () => { timers.forEach(clearTimeout); };
}
