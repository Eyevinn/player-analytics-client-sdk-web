import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");
  const streamUrl =
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4";
  const eventsinkUrl = "https://sink.epas.eyevinn.technology/";
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
