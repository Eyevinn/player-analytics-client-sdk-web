import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");
  const streamUrl =
  "https://testcontent.eyevinn.technology/mp4/VINN.mp4";
  const eventsinkUrl = "https://eyevinnlab-epasdev.eyevinn-player-analytics-eventsink.auto.prod.osaas.io";
  const debug = false;

  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, debug);
  try {
    await analytics.init({
      sessionId: `demo-page-${Date.now()}`,
      heartbeatInterval: 10_000, //defaults to 30_000
    });
    //You want to load your streamsource to your player after you've tried to init your analytics
    analytics.load(videoElement);
  } catch (err) {
    console.error(err);
    analytics.deinit();
  }
  videoElement.src = streamUrl;

  analytics.reportMetadata({
    live: false,
    contentId: "BBB",
    contentUrl: videoElement.src,
  });
});
