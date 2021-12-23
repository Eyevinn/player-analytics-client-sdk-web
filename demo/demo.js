import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");
  const analytics = new PlayerAnalyticsConnector(
    "https://sink.epas.eyevinn.technology/",
    true
  );
  await analytics.init({
    sessionId: `demo-page-${Date.now()}`,
    live: false,
    contentId: "BBB",
    contentUrl: videoElement.src,
  });
  analytics.load(videoElement);
});
