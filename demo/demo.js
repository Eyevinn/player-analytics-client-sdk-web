import { PlayerAnalyticsConnector } from "../index.ts";
import { SGAIAdTrackingUrlsExtractor } from "../index.ts";
import { SGAIAdImpressionSender } from "../index.ts";
import { normalizeEventName } from "../index.ts";
import { SGAIEvent } from "../index.ts";

function getDeviceInfo() {
  const ua = navigator.userAgent || "";
  let deviceType = "desktop";
  let deviceModel = "unknown";
  if (/mobile|android|iphone|ipod|windows phone/i.test(ua)) {
    deviceType = /tablet|ipad/i.test(ua) ? "tablet" : "mobile";
  }
  if (/iPad/i.test(ua)) deviceModel = "iPad";
  else if (/iPhone/i.test(ua)) deviceModel = "iPhone";
  else if (/Android/i.test(ua)) {
    const m = ua.match(/Android\s([0-9.]+)/i);
    deviceModel = m ? "Android " + m[1] : "Android";
  } else if (/Windows NT/i.test(ua)) deviceModel = "Windows";
  else if (/Macintosh/i.test(ua)) deviceModel = "Mac";
  else if (/Linux/i.test(ua)) deviceModel = "Linux";
  return { deviceType, deviceModel };
}

function cleanUrl(raw) {
  let url = (raw || "").trim().replace(/^"|"$/g, "");
  if (url.includes(" ")) url = url.split(" ")[0];
  return url;
}

function generateContentId(url) {
  const u = new URL(url);
  if (u.pathname.endsWith(".m3u8") || u.pathname.endsWith(".mpd")) {
    const i = u.pathname.lastIndexOf("/");
    return i > 0 ? u.pathname.substring(0, i) : u.pathname;
  }
  const parts = u.pathname.split("/");
  let id = parts[parts.length - 1];
  const dot = id.lastIndexOf(".");
  if (dot > 0) id = id.substring(0, dot);
  return id;
}

document.addEventListener("DOMContentLoaded", async () => {
  const videoElement = document.getElementById("videoPlayer");
  const inputElement = document.getElementById("videoUrlInput");
  const contentIdInputField = document.getElementById("contentIdInputField");
  const loadBtn = document.getElementById("loadButton");


  let playerWrap = document.getElementById("playerWrap");
  if (!playerWrap || !playerWrap.contains(videoElement)) {
    playerWrap = document.createElement("div");
    playerWrap.id = "playerWrap";
    Object.assign(playerWrap.style, {
      position: "relative",
      display: "inline-block",
      lineHeight: "0",
      maxWidth: "100%",
    });
    const parent = videoElement.parentNode;
    parent.insertBefore(playerWrap, videoElement);
    playerWrap.appendChild(videoElement);
  }

  // Analytics
  const eventsinkUrl = "https://eyevinn-epas1.eyevinn-player-analytics-eventsink.auto.prod.osaas.io/";
  const analytics = new PlayerAnalyticsConnector(eventsinkUrl, false);

  async function loadVideo(urlRaw) {
    const url = cleanUrl(urlRaw);
    if (!url) return;

    await analytics.init({ sessionId: "demo-page-" + Date.now(), heartbeatInterval: 10000 });
    analytics.load(videoElement);

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const PROGRESS_LINE_BOTTOM = isMobile ? 16 : 20;
    const OVERLAY_BAND = 8;

    function ensureAdOverlay() {
      let overlay = document.getElementById("ad-markers-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "ad-markers-overlay";
        Object.assign(overlay.style, {
          position: "absolute",
          left: "0",
          right: "0",
          bottom: PROGRESS_LINE_BOTTOM + "px",
          height: OVERLAY_BAND + "px",
          pointerEvents: "none",
          zIndex: "10",
        });
        playerWrap.appendChild(overlay);
        const ro = new ResizeObserver(function () {
          overlay.style.bottom = PROGRESS_LINE_BOTTOM + "px";
          overlay.style.height = OVERLAY_BAND + "px";
        });
        ro.observe(videoElement);
      } else {
        overlay.style.bottom = PROGRESS_LINE_BOTTOM + "px";
        overlay.style.height = OVERLAY_BAND + "px";
        overlay.innerHTML = "";
      }
      return overlay;
    }

    // Initialize tracking components
    const extractor = new SGAIAdTrackingUrlsExtractor();
    const pixelSender = new SGAIAdImpressionSender();
    const addedCueIds = new Set();


    function assetListUrlFromInterstitial(interstitialData) {
      return interstitialData && interstitialData.assetListUrl ||
        interstitialData && interstitialData.uri ||
        null;
    }


    function sendAdEvent(adKey, eventType) {
      console.log("[SGAI] === SEND HLS AD EVENT ===");
      console.log("[SGAI] Ad Key:", adKey);
      console.log("[SGAI] Event Type:", eventType);

      const all = extractor.getAll();
      console.log("[SGAI] All available tracking data keys:", Object.keys(all));


      let trackingData = null;
      let mappedKey = adKey;


      if (all[adKey]) {
        trackingData = all[adKey];
      } else {

        const availableKeys = Object.keys(all);
        if (availableKeys.length > 0) {
          mappedKey = availableKeys[0]; // Use the first available key
          trackingData = all[mappedKey];
          console.log("[SGAI] Using fallback key:", mappedKey);
        }
      }

      console.log("[SGAI] Mapped key:", mappedKey);
      console.log("[SGAI] Tracking data:", trackingData);

      if (!trackingData) {
        console.error("[SGAI] NO TRACKING DATA FOUND for HLS interstitial ad");
        return;
      }

      const availableKeys = Object.keys(trackingData || {});
      console.log("[SGAI] Available event keys:", availableKeys);


      let eventToFind = eventType;
      if (eventType === 'impression' && !availableKeys.some(k => k.toLowerCase().includes('impression'))) {
        console.log("[SGAI] No impression URLs found, mapping to start event");
        eventToFind = 'start';
      }

      const tries = [
        String(eventToFind || ""),
        normalizeEventName(eventToFind),
        String(eventToFind || "").toLowerCase(),
        normalizeEventName(eventToFind).toLowerCase()
      ];

      console.log("[SGAI] Trying event variations (in order):", tries);

      let urls = [];
      let foundEventType = null;

      for (let i = 0; i < tries.length && urls.length === 0; i++) {
        const tk = tries[i];
        let matchKey = availableKeys.find(k => k.toLowerCase() === String(tk || "").toLowerCase());

        if (!matchKey && tk) {
          matchKey = availableKeys.find(k => k.toLowerCase().includes(String(tk).toLowerCase()));
        }
        if (matchKey) {
          urls = trackingData[matchKey] || [];
          foundEventType = matchKey;
        }
        console.log("[SGAI] Try", i + 1, "- try:", tk, "=> matchKey:", matchKey, "urlsFound:", urls.length);
      }

      if (urls.length) {
        console.log("[SGAI] ✅ Sending tracking pixels for:", foundEventType);
        console.log("[SGAI] ✅ URLs to fire:", urls);
        pixelSender.sendMultiple(urls, eventType, mappedKey);
      } else {
        console.error("[SGAI] ❌ NO TRACKING URLS FOUND for event:", eventType);
        console.log("[SGAI] Available events:", availableKeys);
      }
    }


    function parseDateRangeLine(line) {
      const obj = {};
      const attrs = line.replace(/^#EXT-X-DATERANGE:/, "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      for (let i = 0; i < attrs.length; i++) {
        const kv = attrs[i].split("=");
        const k = kv[0];
        const vRaw = kv[1] ? kv[1].replace(/^"|"$/g, "") : "";
        obj[k] = /^[0-9.]+$/.test(vRaw) ? Number(vRaw) : vRaw;
      }
      return obj;
    }

    function extractDateRangesFromText(text) {
      const out = [];
      const re = /#EXT-X-DATERANGE:[^\n]+/g;
      let m;
      while ((m = re.exec(text))) out.push(parseDateRangeLine(m[0]));
      return out;
    }

    let hls = null;
    if (window.Hls && window.Hls.isSupported() && /\.m3u8($|\?)/i.test(url)) {
      console.log("[SGAI] Setting up HLS for URL:", url);
      hls = new window.Hls({ enableWorker: false, debug: true });
      hls.loadSource(url);
      hls.attachMedia(videoElement);


      let currentInterstitialId = null;
      let currentAssetId = null;
      let currentAdKey = null;
      let adStartTime = null;
      let adQuartileTimer = null;


      function clearAdQuartileTimer() {
        if (adQuartileTimer) {
          clearInterval(adQuartileTimer);
          adQuartileTimer = null;
          console.log("[SGAI] 🧹 Cleared quartile timer");
        }
      }


      function trackHLSAdQuartiles(duration) {
        clearAdQuartileTimer();
        let lastQ = 0;
        let adStartedAt = Date.now();

        console.log("[SGAI] 🎯 Starting quartile tracking - duration:", duration, "currentAdKey:", currentAdKey);

        adQuartileTimer = setInterval(() => {
          if (!currentAssetId || !duration || !isFinite(duration) || !currentAdKey) {
            return;
          }

          const elapsedMs = Date.now() - adStartedAt;
          const elapsedSeconds = elapsedMs / 1000;
          const progress = Math.min(elapsedSeconds / duration, 1.0);

          let q = 0;
          if (progress >= 0.75) q = 3;
          else if (progress >= 0.5) q = 2;
          else if (progress >= 0.25) q = 1;

          if (q > lastQ && currentAdKey) {
            if (q === 1) {
              console.log("[SGAI] 📊 HLS Ad: First quartile reached (25%)");
              sendAdEvent(currentAdKey, SGAIEvent.FIRST_QUARTILE);
            }
            if (q === 2) {
              console.log("[SGAI] 📊 HLS Ad: Midpoint reached (50%)");
              sendAdEvent(currentAdKey, SGAIEvent.MIDPOINT);
            }
            if (q === 3) {
              console.log("[SGAI] 📊 HLS Ad: Third quartile reached (75%)");
              sendAdEvent(currentAdKey, SGAIEvent.THIRD_QUARTILE);
            }
            lastQ = q;
          }

          if (elapsedSeconds >= duration + 1) {
            console.log("[SGAI] 🏁 Quartile tracking complete - stopping timer");
            clearAdQuartileTimer();
          }
        }, 200);
      }


      hls.on(window.Hls.Events.ERROR, function (_e, data) {
        console.error("[SGAI] HLS Error:", data);
      });

      hls.on(window.Hls.Events.MANIFEST_LOADED, function (_e, data) {
        console.log("[SGAI] HLS Manifest loaded:", data);
      });


      const interstitialEvents = [
        'INTERSTITIAL_STARTED',
        'INTERSTITIAL_ASSET_STARTED',
        'INTERSTITIAL_ASSET_ENDED',
        'INTERSTITIAL_ENDED'
      ];

      interstitialEvents.forEach(eventName => {
        if (window.Hls.Events[eventName]) {
          hls.on(window.Hls.Events[eventName], async function(event, data) {
            console.log(`[SGAI] HLS Event ${eventName}:`, data);

            switch(eventName) {
              case 'INTERSTITIAL_STARTED':
                console.log("[SGAI] === INTERSTITIAL POD STARTED ===");
                currentInterstitialId = data && (data.identifier || data.id);

                if (currentInterstitialId) {
                  const assetListUrl = assetListUrlFromInterstitial(data);
                  if (assetListUrl) {
                    const res = await extractor.extract(assetListUrl, currentInterstitialId);
                    console.log("[SGAI] Extracted tracking for interstitial:", res);
                  }
                }
                break;

              case 'INTERSTITIAL_ASSET_STARTED':
                console.log("[SGAI] === INTERSTITIAL ASSET STARTED ===");
                currentAssetId = data && (data.assetId || data.id || '0');
                adStartTime = videoElement.currentTime;

                currentAdKey = currentInterstitialId ?
                  `${currentInterstitialId}_asset_${currentAssetId}` :
                  `ad-session-1_0_${currentAssetId}`;

                console.log("[SGAI] Sending impression event...");
                sendAdEvent(currentAdKey, SGAIEvent.IMPRESSION);

                console.log("[SGAI] Sending start event...");
                sendAdEvent(currentAdKey, SGAIEvent.START);

                // Get duration and start quartile tracking
                let assetDuration = null;
                if (data && data.duration && data.duration > 0) {
                  assetDuration = data.duration;
                } else if (data && data.asset && data.asset.duration) {
                  assetDuration = data.asset.duration;
                } else {
                  assetDuration = 10; // Default fallback
                }

                if (assetDuration && assetDuration > 0) {
                  trackHLSAdQuartiles(assetDuration);
                }
                break;

              case 'INTERSTITIAL_ASSET_ENDED':
                console.log("[SGAI] === INTERSTITIAL ASSET ENDED ===");
                if (currentAdKey) {
                  sendAdEvent(currentAdKey, SGAIEvent.COMPLETE);
                }
                clearAdQuartileTimer();
                currentAssetId = null;
                currentAdKey = null;
                adStartTime = null;
                break;

              case 'INTERSTITIAL_ENDED':
                console.log("[SGAI] === INTERSTITIAL POD ENDED ===");
                clearAdQuartileTimer();
                currentInterstitialId = null;
                currentAssetId = null;
                currentAdKey = null;
                adStartTime = null;
                break;
            }
          });
        }
      });


      hls.on(window.Hls.Events.LEVEL_LOADED, async function (_e, data) {
        console.log("[SGAI] === HLS LEVEL LOADED ===");
        const details = data.details;
        if (!details) {
          console.log("[SGAI] No details in level loaded event");
          return;
        }

        console.log("[SGAI] Level details:", details);


        let anchorDate = details.programDateTime ? new Date(details.programDateTime) : null;
        const frags = details.fragments || [];

        const firstFragWithPDT = frags.find(function (f) {
          return f && (f.programDateTime || f.pdt);
        });
        if (!anchorDate && firstFragWithPDT) {
          anchorDate = new Date(firstFragWithPDT.programDateTime || firstFragWithPDT.pdt);
        }
        const levelStart = frags.length && isFinite(frags[0].start) ? frags[0].start : 0;


        let ranges = [];
        if (Array.isArray(details.dateRanges) || Array.isArray(details.dateranges)) {
          ranges = details.dateRanges || details.dateranges;
        } else if (details.dateRanges && typeof details.dateRanges === "object") {
          ranges = Object.values(details.dateRanges);
        } else if (details.dateranges && typeof details.dateranges === "object") {
          ranges = Object.values(details.dateranges);
        }


        if (!ranges.length) {
          const raw = (data.networkDetails && (data.networkDetails.responseText ||
            (data.networkDetails.response && data.networkDetails.response.text))) || "";
          if (raw) {
            ranges = extractDateRangesFromText(raw);
          }
        }

        if (!ranges.length) {
          console.warn("[SGAI] ⚠️ NO DATE RANGES FOUND - No visual ad markers will be shown");
          return;
        }

        console.log("[SGAI] === PROCESSING", ranges.length, "DATE RANGES FOR VISUAL MARKERS ===");

        const overlay = ensureAdOverlay();
        const duration = videoElement.duration && isFinite(videoElement.duration) ? videoElement.duration : null;

        ranges.forEach(function (rawRange, index) {
          const klass = rawRange.CLASS || rawRange.class;
          const rid = rawRange.ID || rawRange.id;

          if (klass !== "com.apple.hls.interstitial" || !rid) {
            console.log("[SGAI] Skipping non-interstitial range:", klass, rid);
            return;
          }

          const startDateStr = rawRange["START-DATE"] || rawRange.startDate || rawRange._startDate;
          const dur = Number(rawRange.DURATION || rawRange.duration) || 0;


          let assetList = rawRange["X-ASSET-LIST"] ||
            rawRange["X-ASSETLIST"] ||
            rawRange.assetList ||
            rawRange["x-asset-list"] ||
            rawRange.xAssetList;

          if (!assetList && rawRange.attr && rawRange.attr.toString) {
            const attrStr = rawRange.attr.toString();
            const assetListMatch = attrStr.match(/X-ASSET-LIST=([^,]+)/i);
            if (assetListMatch) {
              assetList = assetListMatch[1].replace(/^"|"$/g, '');
            }
          }


          if (!assetList) {
            const rawManifest = data.networkDetails && (data.networkDetails.responseText ||
              (data.networkDetails.response && data.networkDetails.response.text));

            if (rawManifest && typeof rawManifest === 'string') {
              const dateRangeRegex = new RegExp(`#EXT-X-DATERANGE:[^\\n]*ID="${rid}"[^\\n]*`, 'i');
              const match = rawManifest.match(dateRangeRegex);

              if (match) {
                const dateRangeLine = match[0];
                const assetListMatch = dateRangeLine.match(/X-ASSET-LIST="([^"]+)"/i);
                if (assetListMatch) {
                  assetList = assetListMatch[1];
                }
              }
            }
          }

          if (!startDateStr || dur <= 0 || !anchorDate || !assetList) {
            console.log("[SGAI] Missing required data for range:", {startDateStr, dur, anchorDate: !!anchorDate, assetList});
            return;
          }

          const startDate = new Date(startDateStr);
          const startTime = levelStart + (startDate - anchorDate) / 1000;
          const endTime = startTime + dur;

          console.log("[SGAI] ✅ VALID AD BREAK FOUND for visual marker!");
          console.log("[SGAI] Start time:", startTime, "seconds");
          console.log("[SGAI] End time:", endTime, "seconds");

          // Extract tracking data for ad break
          if (!addedCueIds.has(rid)) {
            extractor.extract(assetList, rid).then((res) => {
              console.log("[SGAI] Extracted tracking data for", rid, ":", res);
            }).catch((err) => {
              console.error("[SGAI] Failed to extract tracking for", rid, ":", err);
            });
            addedCueIds.add(rid);
          }


          if (duration && startTime >= 0) {
            const tick = document.createElement("div");
            const leftPct = (startTime / duration) * 100;
            const DOT_SIZE = 6;
            Object.assign(tick.style, {
              position: "absolute",
              left: Math.min(Math.max(leftPct, 0), 100) + "%",
              transform: "translateX(-50%)",
              width: DOT_SIZE + "px",
              height: DOT_SIZE + "px",
              borderRadius: "50%",
              background: "rgb(255, 215, 0)",
              border: "1px solid rgba(0, 0, 0, 0.5)",
              boxShadow: "0 0 3px rgba(255, 215, 0, 0.8)",
            });
            overlay.appendChild(tick);
            console.log("[SGAI] ✅ Added visual marker at", leftPct.toFixed(1), "%");
          } else {
            console.warn("[SGAI] Cannot add marker - duration:", duration, "startTime:", startTime);
          }
        });
      });

    } else {
      console.log("[SGAI] Not an HLS stream or HLS not supported, using direct video source");
      videoElement.src = url;
    }

    const userContentId = (contentIdInputField && contentIdInputField.value || "").trim();
    const contentId = userContentId || generateContentId(url);
    const dev = getDeviceInfo();
    analytics.reportMetadata({
      live: false,
      contentId: contentId,
      contentUrl: videoElement.src || url,
      deviceType: dev.deviceType,
      deviceModel: dev.deviceModel,
    });


    videoElement.play().catch(function () {
      console.log("[SGAI] Auto-play prevented, waiting for user interaction");
    });
  }


  loadBtn.addEventListener("click", function () {
    loadVideo(inputElement.value);
  });

  inputElement.addEventListener("keydown", function (e) {
    if (e.key === "Enter") loadBtn.click();
  });

  const graf = document.getElementById("grafana-link");
  if (graf) {
    graf.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") window.open(this.href, "_blank", "noopener");
    });
  }
});