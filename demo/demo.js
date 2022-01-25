import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");

  const eventsinkUrl = "https://sink.epas.eyevinn.technology/";
  const debug = true;

  const analytics = new PlayerAnalyticsConnector(
    eventsinkUrl,
    debug
  );
  await analytics.init({
    sessionId: `demo-page-${Date.now()}`,
    live: false,
    contentId: "BBB",
    contentUrl: videoElement.src,
  });
  analytics.load(videoElement);
});
