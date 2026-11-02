export const HEARTBEAT_INTERVAL = 30000;

import packageJson from "@eyevinn/player-analytics-specification/package.json";
export const EPAS_VERSION = packageJson.version;

import sdkPackageJson from "../../package.json";
// Identifies this SDK on every event once the eventsink advertises an EPAS
// version that understands the `sdk` field (>= MIN_SDK_EPAS_VERSION). Sending
// `sdk` also declares that `playhead`/`duration` are integer milliseconds.
export const SDK_NAME = "web";
export const SDK_VERSION = sdkPackageJson.version;

// Minimum EPAS version an eventsink must advertise before the SDK switches to
// "modern" mode: integer-millisecond playhead/duration plus the `sdk` field.
// Eventsinks validating against <= 0.6.0 reject `sdk` with a 400, so below this
// the SDK stays byte-for-byte on the legacy (seconds, no `sdk`) wire format.
export const MIN_SDK_EPAS_VERSION = "0.7.0";
