# Player Analytics Client SDK Web

Part of [Eyevinn Player Analytics Specification](https://github.com/Eyevinn/player-analytics-specification). To be used together with [Eyevinn Player Analytics Eventsink](https://github.com/Eyevinn/player-analytics-eventsink)

```
npm install @eyevinn/player-analytics-client-sdk-web
```

## Usage

### Automatic Event Listening

```js
import { PlayerAnalyticsConnector } from "@eyevinn/player-analytics-client-sdk-web";

// Create your instance and set the analytics eventsink endpoint
const playerAnalytics = new PlayerAnalyticsConnector("https://eventsink-url.io");

// Initiate the analytics with the base data needed
// This will create you session in the backend
playerAnalytics.init({
  sessionId: "generated-unique-uuid-session-id",
  live: false,
  contentId: "big-buck-bunny-720",
  contentUrl:
    "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4",
});

// Get you video element from the site, or your video player of choice
const videoElement = document.querySelector("video");
// Load the analytics library with the video element to fetch the events
playerAnalytics.load(videoElement);
```

Due to bitrate changes not being reported, and errors not being reported in any descriptive way, there is a possibility to do separate calls for these events - which you may trigger based on you video player of choice following these examples.

```js
playerAnalytics.reportBitrateChange({
  bitrate: "", // bitrate in Kbps
  width: "", // optional, video width in pixels
  height: "", // optional, video height in pixels
  videoBitrate: "", // optional, if available provide the bitrate for the video track
  audioBitrate: "", // optional, if available provide the bitrate for the audio track
});
```

```js
// error is fatal, i.e. sends an end event as well
playerAnalytics.reportError({
  category: "", // optional, eg. NETWORK, DECODER, etc.
  code: "",
  message: "", // optional
  data: {}, // optional
});

// warning is not fatal
playerAnalytics.reportWarning({
  category: "", // optional, eg. NETWORK, DECODER, etc.
  code: "",
  message: "", // optional
  data: {}, // optional
});
```

### Manual Event Triggering

```js
import { PlayerAnalytics } from "@eyevinn/player-analytics-client-sdk-web";

// Create your instance and set the analytics eventsink endpoint
const playerAnalytics = new PlayerAnalytics("https://eventsink-url.io");
playerAnalytics.init({
  sessionId: "generated-unique-uuid-session-id",
  live: false,
  contentId: "big-buck-bunny-720",
  contentUrl:
    "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4",
});

// then trigger the method calls accordingly, e.g.
const videoElement = document.querySelector("video");
videoElement.addEventListener("play", () => {
  playerAnalytics.playing({
    event: "playing",
    timestamp: Date.now(),
    playhead: 0,
    duration: 3600,
    sessionId: "generated-unique-uuid-session-id"
  });
});
```

### Init parameters

```ts
export interface IPlayerAnalyticsInitOptions {
  sessionId?: string; // should be generated by the backend if not sent in
  live: boolean;
  contentId: string;
  contentUrl: string;
  drmType?: string;
  userId?: string;
  deviceId?: string;
  deviceModel?: string;
  deviceType?: string;
}
```

## Development

Run the demo page by `npm start`
