import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");

  const eventsinkUrl = "https://dev-sink.epas.eyevinn.technology/";
  const debug = false;

  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, debug);

  await analytics.init({
    sessionId: `demo-page-${Date.now()}`,
    contentId: "BBB",
    contentUrl: videoElement.src,
    heartbeatInterval: 5000,
  });

  analytics.load(videoElement);

  //Should be set up with your tech and a proper listener..
  videoElement.addEventListener("canplay", () => {
    analytics.reportMetadata({ live: false });
  });
});
