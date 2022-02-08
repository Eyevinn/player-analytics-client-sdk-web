export enum EPASEvents {
  loading = "loading",
  loaded = "loaded",
  play = "playing",
  resume = "playing",
  pause = "paused",
  seeking = "seeking",
  seeked = "seeked",
  buffering = "buffering",
  buffered = "buffered",
  ended = "stopped",
  error = "error",
  warning = "warning",
  bitratechanged = "bitrate_changed",
  heartbeat = "hearbeat",
}

export const HEARTBEAT_INTERVAL = 30000;
