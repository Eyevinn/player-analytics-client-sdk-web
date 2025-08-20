export function cleanUrl(raw: string): string {
  try { return new URL(raw).toString(); } catch { return raw; }
}

export function safeDecode(u: string): string {
  try { return decodeURIComponent(u); } catch { return u; }
}

export function isSameOrigin(u: string): boolean {
  try { return new URL(u, location.href).origin === location.origin; } catch { return false; }
}