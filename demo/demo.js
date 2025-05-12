import { PlayerAnalyticsConnector } from "../index.ts";

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

document.addEventListener("DOMContentLoaded", () => {
  const videoElement = document.getElementById("videoPlayer");
  const inputElement = document.getElementById("videoUrlInput");
  const contentIdInputField = document.getElementById("contentIdInputField");
  const loadBtn = document.getElementById("loadButton");

  const eventsinkUrl =
    "https://eyevinn-epas1.eyevinn-player-analytics-eventsink.auto.prod.osaas.io/";
  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, false);

  function cleanUrl(raw) {
    let url = raw.trim().replace(/^"|"$/g, "");
    if (url.includes(" ")) {
      url = url.split(" ")[0];
    }
    return url;
  }

  function generateContentId(url) {
    const parsedUrl = new URL(url);
    let contentId;
    if (
      parsedUrl.pathname.endsWith(".m3u8") ||
      parsedUrl.pathname.endsWith(".mpd")
    ) {
      // Extract path up to the last slash for manifest files
      const lastSlashIndex = parsedUrl.pathname.lastIndexOf("/");
      contentId =
        lastSlashIndex > 0
          ? parsedUrl.pathname.substring(0, lastSlashIndex)
          : parsedUrl.pathname;
    } else {
      // Use filename for other files
      const pathSegments = parsedUrl.pathname.split("/");
      contentId = pathSegments[pathSegments.length - 1];
      // Remove file extension from the contentId
      const fileExtIndex = contentId.lastIndexOf(".");
      if (fileExtIndex > 0) {
        contentId = contentId.substring(0, fileExtIndex);
      }
    }
    return contentId;
  }

  async function loadVideo(urlRaw) {
    const url = cleanUrl(urlRaw);
    if (!url) return;

    await analytics.init({
      sessionId: `demo-page-${Date.now()}`,
      heartbeatInterval: 10000,
    });
    analytics.load(videoElement);
    if (Hls.isSupported() && url.endsWith(".m3u8")) {
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(videoElement);
    } else {
      videoElement.src = url;
    }

    // Use input field contentId if available, otherwise generate from URL
    const userContentId = contentIdInputField.value.trim();
    const contentId = userContentId || generateContentId(url);

    const { deviceType, deviceModel } = getDeviceInfo();
    analytics.reportMetadata({
      live: false,
      contentId: contentId,
      contentUrl: videoElement.src,
      deviceType: deviceType,
      deviceModel: deviceModel,
    });
    videoElement.play();
  }

  loadBtn.addEventListener("click", () => {
    const url = inputElement.value;
    loadVideo(url);
  });

  inputElement.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      loadBtn.click();
    }
  });

  // Accessibility for Grafana
  document
    .getElementById("grafana-link")
    .addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        window.open(this.href, "_blank", "noopener");
      }
    });
});
