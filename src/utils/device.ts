export function getDeviceInfo(): { deviceType: "desktop" | "tablet" | "mobile"; deviceModel: string } {
  const ua = navigator.userAgent || "";
  let deviceType: "desktop" | "tablet" | "mobile" = "desktop";
  let deviceModel = "unknown";

  if (/mobile|android|iphone|ipod|windows phone/i.test(ua)) {
    deviceType = /tablet|ipad/i.test(ua) ? "tablet" : "mobile";
  }

  if (/iPad/i.test(ua)) deviceModel = "iPad";
  else if (/iPhone/i.test(ua)) deviceModel = "iPhone";
  else if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([0-9.]+)/i);
    deviceModel = `Android ${m ? m[1] : ""}`.trim();
  } else if (/Macintosh|Mac OS X/i.test(ua)) deviceModel = "Mac";
  else if (/Windows NT/i.test(ua)) deviceModel = "Windows";
  else if (/Linux/i.test(ua)) deviceModel = "Linux";

  return { deviceType, deviceModel };
}
