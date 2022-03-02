import { PlayerAnalyticsConnector } from "../index.ts";

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.querySelector("video");

  const streamUrl =
    "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4";
  videoElement.src = streamUrl;

  const eventsinkUrl = "https://sink.epas.eyevinn.technology/";
  const debug = false;

  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, debug);
  try {
    await analytics.init({
      sessionId: `demo-page-${Date.now()}`,
      heartbeatInterval: 5000, //defaults to 30_000
    });
    analytics.load(videoElement);
    //can be reported anytime between 'init' and 'stopped'.
    analytics.reportMetadata({
      live: false,
      contentId: "BBB",
      contentUrl: videoElement.src,
    });
  } catch (err) {
    console.error(err);
    analytics.deinit();
    return
  }

  videoElement.addEventListener("canplay", () => {
    videoElement.play();
  });
});
