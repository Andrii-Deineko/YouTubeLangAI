console.log('[YT-Lang-AI] MAIN interceptor booted', location.href);
"use strict";
(() => {
  // src/injected/interceptor.ts
  var MAIN_MESSAGE_SOURCE = "YT_LANG_AI_MAIN";
  var ISOLATED_MESSAGE_SOURCE = "YT_LANG_AI_ISOLATED";
  (() => {
    const GLOBAL_GUARD = "__YT_LANG_AI_INTERCEPTOR_INSTALLED__";
    const winRecord = window;
    if (winRecord[GLOBAL_GUARD]) {
      return;
    }
    winRecord[GLOBAL_GUARD] = true;
    const originalFetch = window.fetch.bind(window);
    const OriginalXHROpen = XMLHttpRequest.prototype.open;
    const OriginalXHRSend = XMLHttpRequest.prototype.send;
    const xhrMetaMap = /* @__PURE__ */ new WeakMap();
    const videoBaseTimedtextMap = /* @__PURE__ */ new Map();
    let lastBaseTimedtextUrl = null;
    let fallbackTimerId = null;
    const capturedTracksMap = /* @__PURE__ */ new Map();
    const capturedTranslatedMap = /* @__PURE__ */ new Map();
    let lastCapturedTrack = null;
    let lastCapturedTranslatedTrack = null;
    const captionTracksCache = /* @__PURE__ */ new Map();
    function postToIsolated(message) {
      window.postMessage(message, "*");
    }
    function extractVideoIdFromLocation() {
      try {
        const url = new URL(window.location.href);
        const v = url.searchParams.get("v");
        if (v) return v;
        const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (shortsMatch?.[1]) return shortsMatch[1];
      } catch {
      }
      return "";
    }
    function extractVideoId(urlObj) {
      if (urlObj) {
        const v = urlObj.searchParams.get("v");
        if (v) return v;
      }
      const fromLoc = extractVideoIdFromLocation();
      if (fromLoc) return fromLoc;
      return "unknown";
    }
    function parseTimedtextUrl(rawUrl) {
      if (!rawUrl || !rawUrl.includes("/api/timedtext")) return null;
      try {
        const url = new URL(rawUrl, window.location.origin);
        if (url.pathname.includes("/api/timedtext")) {
          return url;
        }
        return null;
      } catch {
        return null;
      }
    }
    function isJson3Data(value) {
      if (typeof value !== "object" || value === null) return false;
      const candidate = value;
      return Array.isArray(candidate.events);
    }
    function decodeHtmlEntities(str) {
      return str.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
    }
    function parseTimestamp(hours, minutes, seconds, millis) {
      const h = hours ? parseInt(hours, 10) : 0;
      const m = parseInt(minutes, 10);
      const s = parseInt(seconds, 10);
      const ms = parseInt(millis, 10);
      return (h * 3600 + m * 60 + s) * 1e3 + ms;
    }
    function parseVttToEvents(vttText) {
      const events = [];
      const cueRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n?$|$)/g;
      let match = null;
      while ((match = cueRegex.exec(vttText)) !== null) {
        const startMs = parseTimestamp(match[1], match[2], match[3], match[4]);
        const endMs = parseTimestamp(match[5], match[6], match[7], match[8]);
        const text = match[9].replace(/<[^>]+>/g, "").trim();
        if (text) {
          events.push({
            tStartMs: startMs,
            dDurationMs: Math.max(endMs - startMs, 100),
            segs: [{ utf8: text }]
          });
        }
      }
      return events.length > 0 ? { events } : null;
    }
    function parseTimedtextToEvents(rawText) {
      const trimmed = rawText.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const data = JSON.parse(trimmed);
          if (isJson3Data(data)) return data;
        } catch {
        }
      }
      if (trimmed.includes("<timedtext") && trimmed.includes("<p ")) {
        const events = [];
        const pRegex = /<p\s+([^>]+)>(.*?)<\/p>/gs;
        let pMatch = null;
        while ((pMatch = pRegex.exec(trimmed)) !== null) {
          const attrs = pMatch[1];
          const content = pMatch[2];
          const tMatch = attrs.match(/\bt="(\d+)"/);
          const dMatch = attrs.match(/\bd="(\d+)"/);
          const tStartMs = tMatch ? parseInt(tMatch[1], 10) : 0;
          const dDurationMs = dMatch ? parseInt(dMatch[1], 10) : 0;
          const segs = [];
          const sRegex = /<s([^>]*)>([^<]*)<\/s>/gs;
          let sMatch = null;
          let hasSegs = false;
          while ((sMatch = sRegex.exec(content)) !== null) {
            hasSegs = true;
            const sAttrs = sMatch[1];
            const offsetMatch = sAttrs.match(/\bt="(\d+)"/);
            const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : void 0;
            const text = decodeHtmlEntities(sMatch[2]);
            if (text) {
              segs.push({ utf8: text, ...offset !== void 0 ? { tOffsetMs: offset } : {} });
            }
          }
          if (!hasSegs) {
            const cleanText = decodeHtmlEntities(content.replace(/<[^>]+>/g, ""));
            if (cleanText) segs.push({ utf8: cleanText });
          }
          if (segs.length > 0) {
            events.push({ tStartMs, dDurationMs, segs });
          }
        }
        if (events.length > 0) return { events };
      }
      if (trimmed.includes("<transcript") || trimmed.includes("<text ") && trimmed.includes("start=")) {
        const events = [];
        const textRegex = /<text\s+([^>]+)>([^<]*)<\/text>/gs;
        let match = null;
        while ((match = textRegex.exec(trimmed)) !== null) {
          const attrs = match[1];
          const rawSegText = decodeHtmlEntities(match[2]);
          const startMatch = attrs.match(/\bstart="([\d.]+)"/);
          const durMatch = attrs.match(/\bdur="([\d.]+)"/);
          const startSec = startMatch ? parseFloat(startMatch[1]) : 0;
          const durSec = durMatch ? parseFloat(durMatch[1]) : 2;
          events.push({
            tStartMs: Math.round(startSec * 1e3),
            dDurationMs: Math.round(durSec * 1e3),
            segs: [{ utf8: rawSegText }]
          });
        }
        if (events.length > 0) return { events };
      }
      if (trimmed.startsWith("WEBVTT") || trimmed.includes("-->")) {
        const vttEvents = parseVttToEvents(trimmed);
        if (vttEvents) return vttEvents;
      }
      return null;
    }
    function buildPayload(urlObj, data) {
      const videoId = extractVideoId(urlObj);
      const lang = urlObj.searchParams.get("lang") ?? "unknown";
      const tlang = urlObj.searchParams.get("tlang") ?? void 0;
      const kind = urlObj.searchParams.get("kind") ?? void 0;
      return {
        videoId,
        lang,
        tlang,
        kind,
        url: urlObj.toString(),
        data
      };
    }
    function dispatchCapturedTrack(payload, isTranslated) {
      const eventCount = payload.data.events?.length ?? 0;
      console.log("[YT-Lang-AI] Timedtext intercepted in MAIN world:", {
        videoId: payload.videoId,
        isTranslated,
        lang: payload.lang,
        tlang: payload.tlang,
        eventCount,
        url: payload.url
      });
      if (isTranslated) {
        if (payload.videoId && payload.videoId !== "unknown") {
          capturedTranslatedMap.set(payload.videoId, payload);
        }
        lastCapturedTranslatedTrack = payload;
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: "TRANSLATED_TRACK_CAPTURED",
          videoId: payload.videoId,
          payload
        });
      } else {
        if (payload.videoId && payload.videoId !== "unknown") {
          capturedTracksMap.set(payload.videoId, payload);
        }
        lastCapturedTrack = payload;
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: "TRACK_CAPTURED",
          videoId: payload.videoId,
          payload
        });
      }
    }
    function recordOriginalTrackUrl(urlObj) {
      if (!urlObj.searchParams.get("tlang")) {
        const videoId = extractVideoId(urlObj);
        const rawUrl = urlObj.toString();
        lastBaseTimedtextUrl = rawUrl;
        if (videoId && videoId !== "unknown") {
          videoBaseTimedtextMap.set(videoId, rawUrl);
        }
      }
    }
    function extractCaptionTracksFromObject(obj) {
      if (!obj || typeof obj !== "object") return null;
      const record = obj;
      const captions = record.captions;
      const renderer = captions?.playerCaptionsTracklistRenderer;
      const tracks = renderer?.captionTracks;
      if (Array.isArray(tracks) && tracks.length > 0) {
        return tracks;
      }
      return null;
    }
    function handlePlayerResponseData(data) {
      if (!data || typeof data !== "object") return;
      const record = data;
      const videoDetails = record.videoDetails;
      const videoId = typeof videoDetails?.videoId === "string" ? videoDetails.videoId : extractVideoId();
      const tracks = extractCaptionTracksFromObject(data);
      if (tracks && tracks.length > 0 && videoId && videoId !== "unknown") {
        console.log("[YT-Lang-AI] Cached captionTracks from player API for videoId:", videoId, tracks.length);
        captionTracksCache.set(videoId, tracks);
      }
    }
    function getCaptionTracksFromGlobals() {
      const win = window;
      const candidates = [
        win.ytInitialPlayerResponse,
        win.ytplayer?.config
      ];
      for (const candidate of candidates) {
        let parsed = candidate;
        if (typeof candidate === "string") {
          try {
            parsed = JSON.parse(candidate);
          } catch {
            parsed = null;
          }
        }
        if (parsed && typeof parsed === "object") {
          const record = parsed;
          const rawResponse = record.args?.raw_player_response;
          const target = rawResponse && typeof rawResponse === "object" ? rawResponse : record;
          const tracks = extractCaptionTracksFromObject(target);
          if (tracks && tracks.length > 0) {
            const vDetails = target.videoDetails;
            const vid = typeof vDetails?.videoId === "string" ? vDetails.videoId : void 0;
            return { videoId: vid, tracks };
          }
        }
      }
      return null;
    }
    function cancelFallbackTimer() {
      if (fallbackTimerId !== null) {
        window.clearTimeout(fallbackTimerId);
        fallbackTimerId = null;
      }
    }
    function scheduleFallbackActivation() {
      cancelFallbackTimer();
      const targetVideoId = extractVideoId();
      fallbackTimerId = window.setTimeout(async () => {
        fallbackTimerId = null;
        const currentVideoId = extractVideoId();
        const effectiveVid = currentVideoId !== "unknown" ? currentVideoId : targetVideoId;
        if (effectiveVid && effectiveVid !== "unknown" && capturedTracksMap.has(effectiveVid)) {
          return;
        }
        console.log("[YT-Lang-AI] 1200ms fallback check for videoId:", effectiveVid);
        const globalData = getCaptionTracksFromGlobals();
        let tracks = null;
        if (effectiveVid && captionTracksCache.has(effectiveVid)) {
          tracks = captionTracksCache.get(effectiveVid) ?? null;
        } else if (globalData?.tracks && globalData.tracks.length > 0) {
          tracks = globalData.tracks;
          if (effectiveVid && effectiveVid !== "unknown") {
            captionTracksCache.set(effectiveVid, tracks);
          }
        }
        if (tracks && tracks.length > 0) {
          console.log("[YT-Lang-AI] Found captionTracks via fallback:", tracks.length);
          const preferred = tracks.find((t) => t.kind !== "asr") ?? tracks[0];
          if (preferred?.baseUrl) {
            try {
              const trackUrl = new URL(preferred.baseUrl, window.location.origin);
              trackUrl.searchParams.set("fmt", "json3");
              if (effectiveVid && effectiveVid !== "unknown" && !trackUrl.searchParams.get("v")) {
                trackUrl.searchParams.set("v", effectiveVid);
              }
              if (preferred.languageCode && !trackUrl.searchParams.get("lang")) {
                trackUrl.searchParams.set("lang", preferred.languageCode);
              }
              if (preferred.kind && !trackUrl.searchParams.get("kind")) {
                trackUrl.searchParams.set("kind", preferred.kind);
              }
              console.log("[YT-Lang-AI] Fetching fallback track from baseUrl (fmt=json3):", trackUrl.toString());
              const ok = await fetchAndDispatchTrack(trackUrl, false);
              if (ok) return;
              console.log("[YT-Lang-AI] Fallback with fmt=json3 failed, trying raw baseUrl:", preferred.baseUrl);
              const rawUrl = new URL(preferred.baseUrl, window.location.origin);
              const rawOk = await fetchAndDispatchTrack(rawUrl, false);
              if (rawOk) return;
            } catch (err) {
              console.warn("[YT-Lang-AI] Error fetching fallback track:", err);
            }
          }
        }
        console.log("[YT-Lang-AI] Activating native player captions fallback");
        const activePlayer = document.querySelector("#movie_player") ?? document.querySelector("ytd-reel-video-renderer[is-active] #shorts-player") ?? document.querySelector("ytd-reel-video-renderer[is-active] .html5-video-player") ?? document.querySelector(".html5-video-player");
        if (activePlayer) {
          try {
            const playerApi = activePlayer;
            playerApi.loadModule?.("captions");
          } catch {
          }
          const subtitlesBtn = activePlayer.querySelector(".ytp-subtitles-button") ?? document.querySelector(".ytp-subtitles-button");
          if (subtitlesBtn && subtitlesBtn.getAttribute("aria-pressed") !== "true") {
            console.log("[YT-Lang-AI] Triggering native subtitles button click");
            subtitlesBtn.click();
          }
        }
      }, 1200);
    }
    async function fetchAndDispatchTrack(urlObj, isTranslated) {
      try {
        const response = await originalFetch(urlObj.toString(), {
          credentials: "include"
        });
        if (!response.ok) {
          return false;
        }
        const text = await response.text();
        const parsed = parseTimedtextToEvents(text);
        if (!parsed || !parsed.events || parsed.events.length === 0) {
          return false;
        }
        const payload = buildPayload(urlObj, parsed);
        dispatchCapturedTrack(payload, isTranslated);
        return true;
      } catch (err) {
        console.warn("[YT-Lang-AI] Error fetching timedtext:", err);
        return false;
      }
    }
    function handleCapturedText(urlObj, rawText) {
      try {
        const parsed = parseTimedtextToEvents(rawText);
        if (!parsed || !parsed.events || parsed.events.length === 0) return false;
        const isTranslated = Boolean(urlObj.searchParams.get("tlang"));
        const payload = buildPayload(urlObj, parsed);
        dispatchCapturedTrack(payload, isTranslated);
        return true;
      } catch {
        return false;
      }
    }
    function getRequestUrl(input) {
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.href;
      if (input && typeof input.url === "string") return input.url;
      return "";
    }
    window.fetch = async function patchedFetch(input, init) {
      const rawUrl = getRequestUrl(input);
      if (rawUrl.includes("/youtubei/v1/player")) {
        const response2 = await originalFetch(input, init);
        try {
          const cloned = response2.clone();
          void cloned.json().then((playerData) => {
            handlePlayerResponseData(playerData);
          }).catch(() => void 0);
        } catch {
        }
        return response2;
      }
      const timedtextUrl = parseTimedtextUrl(rawUrl);
      if (!timedtextUrl) {
        return originalFetch(input, init);
      }
      cancelFallbackTimer();
      recordOriginalTrackUrl(timedtextUrl);
      const isTranslated = Boolean(timedtextUrl.searchParams.get("tlang"));
      const response = await originalFetch(input, init);
      if (response.ok) {
        try {
          const cloned = response.clone();
          void cloned.text().then((text) => {
            const dispatched = handleCapturedText(timedtextUrl, text);
            if (!dispatched && timedtextUrl.searchParams.get("fmt") !== "json3") {
              const json3Url = new URL(timedtextUrl.toString());
              json3Url.searchParams.set("fmt", "json3");
              void fetchAndDispatchTrack(json3Url, isTranslated);
            }
          }).catch(() => void 0);
        } catch {
        }
      }
      return response;
    };
    XMLHttpRequest.prototype.open = function patchedOpen(method, url, async, username, password) {
      const urlStr = typeof url === "string" ? url : url.toString();
      xhrMetaMap.set(this, { url: urlStr });
      OriginalXHROpen.call(
        this,
        method,
        urlStr,
        async ?? true,
        username ?? null,
        password ?? null
      );
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const meta = xhrMetaMap.get(this);
      const timedtextUrl = meta ? parseTimedtextUrl(meta.url) : null;
      if (timedtextUrl) {
        cancelFallbackTimer();
        recordOriginalTrackUrl(timedtextUrl);
        this.addEventListener("load", () => {
          if (this.status < 200 || this.status >= 300) return;
          const isTranslated = Boolean(timedtextUrl.searchParams.get("tlang"));
          let dispatched = false;
          if (typeof this.responseText === "string" && this.responseText.length > 0) {
            dispatched = handleCapturedText(timedtextUrl, this.responseText);
          } else if (this.response && typeof this.response === "object" && isJson3Data(this.response)) {
            dispatchCapturedTrack(buildPayload(timedtextUrl, this.response), isTranslated);
            dispatched = true;
          }
          if (!dispatched && timedtextUrl.searchParams.get("fmt") !== "json3") {
            const json3Url = new URL(timedtextUrl.toString());
            json3Url.searchParams.set("fmt", "json3");
            void fetchAndDispatchTrack(json3Url, isTranslated);
          }
        });
      }
      OriginalXHRSend.call(this, body ?? null);
    };
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (typeof event.data !== "object" || event.data === null) return;
      const data = event.data;
      const isFromContent = data.source === ISOLATED_MESSAGE_SOURCE || data.source === "YT_LANG_AI_CONTENT";
      if (!isFromContent) return;
      if (data.type === "GET_LATEST_TRACK") {
        const requestedVid = data.payload?.videoId ?? data.videoId ?? extractVideoId();
        console.log("[YT-Lang-AI] MAIN received GET_LATEST_TRACK:", {
          requestedVid,
          hasCached: requestedVid && requestedVid !== "unknown" ? capturedTracksMap.has(requestedVid) : false,
          hasLast: Boolean(lastCapturedTrack)
        });
        const track = requestedVid && requestedVid !== "unknown" && capturedTracksMap.get(requestedVid) || lastCapturedTrack;
        if (track) {
          console.log("[YT-Lang-AI] Responding to GET_LATEST_TRACK with cached track:", {
            videoId: track.videoId,
            eventCount: track.data.events?.length ?? 0
          });
          postToIsolated({
            source: MAIN_MESSAGE_SOURCE,
            type: "TRACK_CAPTURED",
            videoId: track.videoId,
            payload: track
          });
        } else {
          scheduleFallbackActivation();
        }
        const transTrack = requestedVid && requestedVid !== "unknown" && capturedTranslatedMap.get(requestedVid) || lastCapturedTranslatedTrack;
        if (transTrack) {
          postToIsolated({
            source: MAIN_MESSAGE_SOURCE,
            type: "TRANSLATED_TRACK_CAPTURED",
            videoId: transTrack.videoId,
            payload: transTrack
          });
        }
        return;
      }
      if (data.type === "NAVIGATED" && data.payload) {
        scheduleFallbackActivation();
        return;
      }
      if (data.type === "REQUEST_TRANSLATED_TRACK" && data.payload) {
        const { nativeLang, videoId } = data.payload;
        const targetVid = videoId || extractVideoIdFromLocation();
        const baseUrlStr = targetVid && videoBaseTimedtextMap.get(targetVid) || lastBaseTimedtextUrl;
        if (!baseUrlStr) {
          postToIsolated({
            source: MAIN_MESSAGE_SOURCE,
            type: "TRACK_ERROR",
            payload: { error: "No base timedtext track captured yet for translation" }
          });
          return;
        }
        try {
          const baseUrl = new URL(baseUrlStr);
          baseUrl.searchParams.set("tlang", nativeLang);
          baseUrl.searchParams.set("fmt", "json3");
          void fetchAndDispatchTrack(baseUrl, true);
        } catch (err) {
          postToIsolated({
            source: MAIN_MESSAGE_SOURCE,
            type: "TRACK_ERROR",
            payload: {
              error: err instanceof Error ? err.message : "Invalid timedtext URL"
            }
          });
        }
      }
    });
    window.addEventListener("yt-navigate-finish", () => {
      scheduleFallbackActivation();
    });
    if (extractVideoIdFromLocation()) {
      scheduleFallbackActivation();
    }
  })();
})();
