import { PlayerAnalyticsConnector } from "@eyevinn/player-analytics-client-sdk-web";

function getDeviceInfo() {
  const ua = navigator.userAgent || "";
  let deviceType = "desktop";
  let deviceModel = "unknown";

  // 1️⃣ Determine form-factor
  if (/mobile|android|iphone|ipod|windows phone/i.test(ua)) {
    deviceType = /tablet|ipad/i.test(ua) ? "tablet" : "mobile";
  }

  // 2️⃣ Pick a simple model label
  if (/iPad/i.test(ua)) {
    deviceModel = "iPad";
  } else if (/iPhone/i.test(ua)) {
    deviceModel = "iPhone";
  } else if (/Android/i.test(ua)) {
    // Grab Android version if available
    const match = ua.match(/Android\s([0-9.]+)/i);
    deviceModel = match ? `Android ${match[1]}` : "Android";
  } else if (/Windows NT/i.test(ua)) {
    deviceModel = "Windows";
  } else if (/Macintosh/i.test(ua)) {
    deviceModel = "Mac";
  } else if (/Linux/i.test(ua)) {
    deviceModel = "Linux";
  }

  return { deviceType, deviceModel };
}

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");
  const inputElement = document.getElementById("videoUrlInput");
  const eventsinkUrl =
    "https://eyevinn-epas1.eyevinn-player-analytics-eventsink.auto.prod.osaas.io/";
  const debug = false;

  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, debug);

  await analytics.init({
    sessionId: `demo-page-${Date.now()}`,
    heartbeatInterval: 10000,
  });

  analytics.load(videoElement);

  // Default video
  let streamUrl =
    "https://archive.org/serve/big-bunny-sample-video/SampleVideo.ia.mp4";
  const contentId = streamUrl.split("/").pop() || "";
  const { deviceType, deviceModel } = getDeviceInfo();

  videoElement.src = streamUrl;
  analytics.reportMetadata({
    live: false,
    contentId: contentId,
    contentUrl: streamUrl,
    deviceType: deviceType,
    deviceModel: deviceModel,
  });

  inputElement.addEventListener("change", () => {
    const newUrl = inputElement.value.trim();
    if (newUrl) {
      videoElement.src = newUrl;
      const contentId = streamUrl.split("/").pop() || "";

      analytics.reportMetadata({
        live: false,
        contentId: contentId,
        contentUrl: newUrl,
        deviceType: deviceType,
        deviceModel: deviceModel,
      });
      videoElement.play();
    }
  });
});
