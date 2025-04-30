import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");
  const inputElement = document.getElementById("videoUrlInput");

  const eventsinkUrl =
    "https://eyevinnlab-epasdev.eyevinn-player-analytics-eventsink.auto.prod.osaas.io";
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
  videoElement.src = streamUrl;
  analytics.reportMetadata({ live: false, contentId: "BBB", contentUrl: streamUrl });

  inputElement.addEventListener("change", () => {
    const newUrl = inputElement.value.trim();
    if (newUrl) {
      videoElement.src = newUrl;
      analytics.reportMetadata({ live: false, contentId: "Custom", contentUrl: newUrl });
      videoElement.play();
    }
  });
});
