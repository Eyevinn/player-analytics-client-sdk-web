import {
  PlayerAnalyticsConnector,
  SGAIAdTracker,
  SGAIEvent,
  UrlUtils,
  DeviceUtils,
  HlsUtils,
  AdsUtils,
} from "../index";

// ---------------------- configurable UI constants ----------------------
const PROGRESS_LINE_BOTTOM = 13;     // px (distance from timeline)
const OVERLAY_BAND = 12;            // marker band height
const DEFAULT_MARKERS_PER_POD = 1;  // number of dots per interstitial

// ---------------------- demo-only helper ----------------------
function generateContentId(url) {
  try {
    const u = new URL(url);
    let id = (u.pathname || "").split("/").filter(Boolean).join("-");
    if (!id) id = u.host || "content";
    const dot = id.lastIndexOf(".");
    if (dot > 0) id = id.substring(0, dot);
    return id;
  } catch {
    const parts = String(url || "").split("/");
    let id = parts.filter(Boolean).join("-");
    const dot = id.lastIndexOf(".");
    if (dot > 0) id = id.substring(0, dot);
    return id || "content";
  }
}

// ---------------------- overlay helpers ----------------------
function createOrGetOverlay(playerWrap) {
  let overlay = document.getElementById("ad-markers-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "ad-markers-overlay";
    playerWrap.appendChild(overlay);
  }
  styleOverlay(overlay);
  return overlay;
}

function styleOverlay(overlay) {
  Object.assign(overlay.style, {
    position: "absolute",
    left: "0",
    right: "0",
    bottom: PROGRESS_LINE_BOTTOM + "px",
    height: OVERLAY_BAND + "px",
    pointerEvents: "none",
    zIndex: "9999",
  });
}

// ---------------------- dot management functions ----------------------
function hideAllDots(overlay) {
  const dots = overlay.querySelectorAll("div");
  dots.forEach((dot) => {
    dot.style.display = "none";
  });
}

function showAllDots(overlay) {
  const dots = overlay.querySelectorAll("div");
  dots.forEach((dot) => {
    dot.style.display = "block";
  });
}

function removeDotNearCurrentTime(overlay, videoElement, toleranceSeconds = 15) {
  const currentTime = videoElement.currentTime;
  const duration = videoElement.duration;

  if (!duration || !isFinite(duration) || !isFinite(currentTime)) return;

  const currentPct = (currentTime / duration) * 100;
  const tolerancePct = (toleranceSeconds / duration) * 100;

  const dots = overlay.querySelectorAll("div");
  dots.forEach((dot) => {
    const dotLeft = parseFloat(dot.style.left);
    if (Math.abs(dotLeft - currentPct) <= tolerancePct) {
      dot.remove();
    }
  });
}

// --------------------------- main -----------------------------
document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.getElementById("videoPlayer");
  const inputElement = document.getElementById("videoUrlInput");
  const contentIdInputField = document.getElementById("contentIdInputField");
  const loadBtn = document.getElementById("loadButton");

  // ensure wrapper for overlay
  let playerWrap = document.getElementById("playerWrap");
  if (!playerWrap || !playerWrap.contains(videoElement)) {
    playerWrap = document.createElement("div");
    playerWrap.id = "playerWrap";
    playerWrap.style.position = "relative";
    playerWrap.style.width = "100%";
    playerWrap.style.maxWidth = "960px";
    playerWrap.style.margin = "0 auto";
    videoElement.parentNode?.insertBefore(playerWrap, videoElement);
    playerWrap.appendChild(videoElement);
  }

  // create overlay once and keep reusing it (no fullscreen handling)
  const overlay = createOrGetOverlay(playerWrap);

  const eventsinkUrl =
    "https://eyevinn-epas1.eyevinn-player-analytics-eventsink.auto.prod.osaas.io/";
  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, false);

  let cancelQuartiles = () => {};

  async function loadVideo(urlRaw) {
    const url = UrlUtils.cleanUrl(urlRaw || inputElement.value || "");
    if (!url) return;

    const providedContentId = (contentIdInputField?.value || "").trim();
    const contentId = providedContentId || generateContentId(url);

    // analytics init
    try {
      const { deviceType, deviceModel } = DeviceUtils.getDeviceInfo();
      analytics.init({ contentId, deviceType, deviceModel });
    } catch (e) {
      console.warn("[demo] analytics.init failed (continuing):", e);
    }

    // SGAI tracker (extractor + sender inside)
    const SESSION_ID = "ad-session-1";
    const adTracker = new SGAIAdTracker(SESSION_ID);
    if (adTracker?.extractor?.setAdsSessionId) {
      adTracker.extractor.setAdsSessionId(SESSION_ID);
    }

    // state for interstitial flow
    let currentAdKey = null;
    let extractPromise = null; // await map population before firing events
    let assetSeqInPod = 0; // index fallback counter

    const isHls =
      /\.m3u8($|\?)/i.test(url) && window.Hls && window.Hls.isSupported();
    let hls = null;

    async function sendAdEventSafe(adKey, eventType) {
      try {
        await adTracker.sendAdEvent(adKey, eventType);
      } catch (e) {
        console.error("[SGAI] sendAdEvent error:", e);
      }
    }

    if (isHls) {
      hls = new window.Hls({ enableWorker: false, debug: true });
      hls.loadSource(url);
      hls.attachMedia(videoElement);

      // ---- SGAI interstitial lifecycle ----
      const EVENTS = [
        "INTERSTITIAL_STARTED",
        "INTERSTITIAL_ASSET_STARTED",
        "INTERSTITIAL_ASSET_ENDED",
        "INTERSTITIAL_ENDED",
      ];

      EVENTS.forEach((name) => {
        if (!window.Hls.Events[name]) return;
        hls.on(window.Hls.Events[name], async (_evt, data) => {
          try {
            switch (name) {
              case "INTERSTITIAL_STARTED": {
                assetSeqInPod = 0;

                // Hide all dots when ad starts
                hideAllDots(overlay);
                console.log("[Ad Markers] Hiding dots - ad started");

                const rid = data?.identifier || data?.id || null;
                const assetListUrl = data?.assetListUrl || data?.uri || null;
                if (rid && assetListUrl) {
                  // populate extractor map (pod + per-asset URLs)
                  extractPromise = adTracker.extractor
                    .extract(assetListUrl, rid)
                    .catch((e) =>
                      console.warn("[SGAI] extractor.extract failed:", e)
                    );
                } else {
                  extractPromise = null;
                }
                break;
              }

              case "INTERSTITIAL_ASSET_STARTED": {
                // robust zero-based index (handles numbers and "0")
                const idx = AdsUtils.resolveAssetIndex(
                  data,
                  () => assetSeqInPod++
                );
                currentAdKey = AdsUtils.buildAdKey(SESSION_ID, idx);

                if (extractPromise) {
                  try {
                    await extractPromise; // ensure map is ready
                  } catch {}
                }

                await sendAdEventSafe(currentAdKey, SGAIEvent.IMPRESSION);
                await sendAdEventSafe(currentAdKey, SGAIEvent.START);

                let assetDuration = 0;
                if (data?.duration > 0) assetDuration = data.duration;
                else if (data?.asset?.duration > 0)
                  assetDuration = data.asset.duration;

                // schedule quartiles with a cancellable handle
                cancelQuartiles();
                cancelQuartiles = AdsUtils.scheduleQuartiles(
                  assetDuration,
                  (ev) => sendAdEventSafe(currentAdKey, ev)
                );
                break;
              }

              case "INTERSTITIAL_ASSET_ENDED": {
                if (currentAdKey) {
                  cancelQuartiles();
                  cancelQuartiles = () => {};
                  await sendAdEventSafe(currentAdKey, SGAIEvent.COMPLETE);
                }
                currentAdKey = null;
                break;
              }

              case "INTERSTITIAL_ENDED": {
                cancelQuartiles();
                cancelQuartiles = () => {};
                currentAdKey = null;
                extractPromise = null;

                // Remove the dot that just played and show remaining dots
                removeDotNearCurrentTime(overlay, videoElement, 15);
                showAllDots(overlay);
                console.log("[Ad Markers] Showing remaining dots - content resumed");
                break;
              }
            }
          } catch (e) {
            console.error(`[SGAI] Error handling ${name}:`, e);
          }
        });
      });

      // ---- draw visual ad markers on LEVEL_LOADED ----
      hls.on(window.Hls.Events.LEVEL_LOADED, async function (_e, data) {
        const details = data?.details;
        if (!details) return;

        const anchorDate = HlsUtils.deriveAnchorDate(details);
        const frags = details.fragments || [];
        const levelStart =
          frags.length && isFinite(frags[0].start) ? frags[0].start : 0;

        // collect dateranges
        let ranges = [];
        if (Array.isArray(details.dateRanges) || Array.isArray(details.dateranges)) {
          ranges = details.dateRanges || details.dateranges;
        } else if (details.dateRanges && typeof details.dateRanges === "object") {
          ranges = Object.values(details.dateRanges);
        } else if (details.dateranges && typeof details.dateranges === "object") {
          ranges = Object.values(details.dateranges);
        }
        if (!ranges.length) {
          const raw = data?.networkDetails?.responseText || "";
          if (raw) ranges = HlsUtils.extractDateRangesFromText(raw);
        }
        if (!ranges.length) return;

        // clear overlay (no fullscreen re-style)
        overlay.innerHTML = "";
        styleOverlay(overlay);

        const duration =
          videoElement.duration && isFinite(videoElement.duration)
            ? videoElement.duration
            : null;

        for (const range of ranges) {
          const klass = range.CLASS || range.class;
          const rid = range.ID || range.id;
          if (klass !== "com.apple.hls.interstitial" || !rid) continue;

          const startDateStr =
            range["START-DATE"] || range.startDate || range._startDate;
          const dur = Number(range.DURATION || range.duration) || 0;

          if (!startDateStr || dur <= 0 || !anchorDate) continue;

          // (Optional) discover X-ASSET-LIST and pre-prime tracking map
          const assetList = HlsUtils.extractAssetListFromRange(
            range,
            data?.networkDetails?.responseText || ""
          );
          if (assetList) {
            try {
              await adTracker.extractor.extract(assetList, rid);
            } catch {}
          }

          const assetCount = DEFAULT_MARKERS_PER_POD;
          const startDate = new Date(startDateStr);
          const deltaSec = (startDate.getTime() - anchorDate.getTime()) / 1000;
          const startTime = levelStart + deltaSec;

          for (let i = 0; i < assetCount; i++) {
            // small +10s nudge to visually separate the dot from range start (keep/remove as you like)
            const segStart = startTime + 8 + (dur / assetCount) * (i + 0.5);
            if (!duration || !isFinite(duration) || !isFinite(segStart)) continue;

            const leftPct = (segStart / duration) * 100;
            const tick = document.createElement("div");
            tick.setAttribute("data-rid", rid);
            tick.setAttribute("data-index", i);
            Object.assign(tick.style, {
              position: "absolute",
              left: Math.min(Math.max(leftPct, 0), 100) + "%",
              transform: "translateX(-50%)",
              width: 3 + "px",
              height: 3 + "px",
              borderRadius: "50%",
              background: "rgb(255, 215, 0)",
              border: "1px solid rgba(0, 0, 0, 0.5)",
              boxShadow: "0 0 2px rgba(255, 215, 0, 0.8)",
            });
            overlay.appendChild(tick);
          }
        }

        console.log("[Ad Markers] Created", overlay.children.length, "ad markers");
      });
    } else {
      // non-HLS path
      videoElement.src = url;
    }

    // analytics wiring
    try {
      analytics.setMediaElement(videoElement);
    } catch (e) {
      console.warn("[demo] analytics.setMediaElement failed:", e);
    }
    try {
      analytics.videoLoaded({ contentId });
      videoElement.addEventListener("play", () => analytics.videoPlaying({}));
      videoElement.addEventListener("pause", () => analytics.videoPaused({}));
      videoElement.addEventListener("seeking", () => analytics.videoSeeking({}));
      videoElement.addEventListener("seeked", () => analytics.videoSeeked({}));
      videoElement.addEventListener("ended", () => analytics.videoEnded({}));
      videoElement.addEventListener("error", (e) => {
        const err =
          (videoElement.error && videoElement.error.message) || "unknown";
        analytics.videoError({ message: String(err), data: { error: e } });
      });
    } catch (e) {
      console.warn("[demo] analytics wiring failed (continuing):", e);
    }

    // autoplay attempt
    try {
      await videoElement.play();
    } catch (e) {
      console.log("[demo] Autoplay blocked; waiting for user gesture.", e);
    }
  }

  // UI wiring
  loadBtn?.addEventListener("click", () => loadVideo(inputElement.value));
  inputElement?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadBtn?.click();
  });

  const graf = document.getElementById("grafana-link");
  if (graf) {
    graf.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ")
        window.open(this.href, "_blank", "noopener");
    });
  }
});
