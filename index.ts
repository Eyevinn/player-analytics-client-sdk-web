export {
  PlayerAnalytics,
  IPlayerAnalyticsInitOptions,
} from "./src/PlayerAnalytics";

export {
  PlayerAnalyticsConnector,
  IPlayerAnalyticsConnectorInitOptions,
} from "./src/PlayerAnalyticsConnector";

export {
  SGAIAdImpressionSender,
  SGAIAdTrackingUrlsExtractor,
  SGAIAdTracker,
  SGAIEvent,
  normalizeEventName,
  mapEventName,
  type SGAIEventType,
  type TrackingEvent,
  type AssetListResponse,
  type TrackingData,
  type TrackingMap,
} from "./src/SGAITracking";

export {
  // Re-export everything from tracking for easier imports
  SGAIAdImpressionSender as AdImpressionSender,
  SGAIAdTrackingUrlsExtractor as AdTrackingExtractor,
  SGAIAdTracker as AdTracker,
} from "./src/SGAITracking";
