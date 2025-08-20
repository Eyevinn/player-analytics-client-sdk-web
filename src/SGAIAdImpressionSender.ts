export class SGAIAdImpressionSender {
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? generateSessionId();
    console.log(
      "[SGAI] Impression sender initialized with session:",
      this.sessionId
    );
  }

  async fire(url: string, eventType: string, adKey: string): Promise<void> {
    try {
      const decoded = safeDecode(url);
      const sameOrigin = isSameOrigin(decoded);

      // Use sendBeacon ONLY for same-origin to avoid POST/CORS issues
      if (sameOrigin && typeof navigator !== "undefined" && typeof (navigator as any).sendBeacon === "function") {
        try {
          (navigator as any).sendBeacon(decoded);
          console.log("[SGAI] Sent via sendBeacon (same-origin):", decoded);
          return;
        } catch {}
      }

      // Cross-origin: use GET without custom headers (to avoid preflight)
      await fetch(decoded, {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        keepalive: true,
        credentials: "omit",
      }).catch(() => { /* opaque/no-cors will look like a failure—ignore */ });

      // Image ping as last-resort fire-and-forget
      try { const img = new Image(); img.src = decoded; } catch {/* ignore */}
    } catch (e) {
      console.error("[SGAI] Failed to send tracking pixel:", e, { eventType, adKey, url });
    }
  }

  sendMultiple(urls: string[], eventType: string, adKey: string): void {
    (urls || []).forEach((u) => this.fire(u, eventType, adKey));
  }

  getSessionId(): string { return this.sessionId; }
}

function isSameOrigin(u: string): boolean {
  try { return new URL(u, location.href).origin === location.origin; } catch { return false; }
}

function safeDecode(u: string): string {
  try { return decodeURIComponent(u); } catch { return u; }
}

function generateSessionId(): string {
  const g: any = (typeof globalThis !== "undefined" ? globalThis : {}) as any;
  try { const uuid = g?.crypto?.randomUUID?.(); if (uuid) return uuid; } catch {}
  try {
    const c = g?.crypto;
    if (c?.getRandomValues) {
      const b = new Uint8Array(16); c.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      const h = [...b].map(x => x.toString(16).padStart(2, "0"));
      return `${h.slice(0,4).join("")}-${h.slice(4,6).join("")}-${h.slice(6,8).join("")}-${h.slice(8,10).join("")}-${h.slice(10).join("")}`;
    }
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require("crypto");
    const hex = nodeCrypto.randomBytes(16).toString("hex");
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}
