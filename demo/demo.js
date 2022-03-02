import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");

  const eventsinkUrl = "https://sink.epas.eyevinn.technology/";
  const debug = false;

  const analytics = new PlayerAnalyticsConnector(
    eventsinkUrl,
    debug
  );
  try {
    await analytics.init({
      sessionId: `demo-page-${Date.now()}`,
      live: false,
      contentId: "BBB",
      contentUrl: videoElement.src,
      heartbeatInterval: 5000,
    });
    analytics.load(videoElement);
  } catch (err) {
    console.error(err);
    analytics.deinit();
  }
});
