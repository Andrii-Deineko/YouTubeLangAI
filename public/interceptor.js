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
    const RATE_LIMIT_STORAGE_KEY = "ytai_timedtext_blocked_until";
    const RATE_LIMIT_COOLDOWN_MS = 12e4;
    const capturedTracksMap = /* @__PURE__ */ new Map();
    const capturedTranslatedMap = /* @__PURE__ */ new Map();
    let lastCapturedTrack = null;
    let lastCapturedTranslatedTrack = null;
    const captionTracksCache = /* @__PURE__ */ new Map();
    const videosWithCachedTrack = /* @__PURE__ */ new Set();
    const requestedTranslations = /* @__PURE__ */ new Set();
    function postToIsolated(message) {
      window.postMessage(message, "*");
    }
    function getRateLimitBlockedUntil() {
      try {
        const val = window.localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
        if (val) {
          const num = Number(val);
          if (!Number.isNaN(num) && num > Date.now()) {
            return num;
          }
        }
      } catch {
      }
      return 0;
    }
    function isCircuitBreakerActive() {
      return getRateLimitBlockedUntil() > Date.now();
    }
    function notifyRateLimited(blockedUntil) {
      const until = blockedUntil ?? getRateLimitBlockedUntil();
      const remainingMs = Math.max(0, until - Date.now());
      if (remainingMs > 0) {
        console.warn("[YT-Lang-AI] Circuit breaker active! Cooldown remaining:", Math.round(remainingMs / 1e3), "sec");
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: "CAPTION_RATE_LIMITED",
          payload: {
            remainingMs,
            blockedUntil: until
          }
        });
      }
    }
    function triggerRateLimitCircuitBreaker() {
      const blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      try {
        window.localStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(blockedUntil));
      } catch {
      }
      cancelFallbackTimer();
      notifyRateLimited(blockedUntil);
    }
    if (isCircuitBreakerActive()) {
      notifyRateLimited();
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
        if (!videoBaseTimedtextMap.has(videoId)) {
          const preferred = tracks.find((t) => t.kind !== "asr") ?? tracks[0];
          if (preferred?.baseUrl) {
            videoBaseTimedtextMap.set(videoId, preferred.baseUrl);
            lastBaseTimedtextUrl = preferred.baseUrl;
          }
        }
      }
    }
    function cancelFallbackTimer() {
      if (fallbackTimerId !== null) {
        window.clearTimeout(fallbackTimerId);
        fallbackTimerId = null;
      }
    }
    function scheduleFallbackActivation() {
      cancelFallbackTimer();
      if (isCircuitBreakerActive()) {
        notifyRateLimited();
        return;
      }
      const targetVideoId = extractVideoId();
      fallbackTimerId = window.setTimeout(() => {
        fallbackTimerId = null;
        if (isCircuitBreakerActive()) {
          notifyRateLimited();
          return;
        }
        const currentVideoId = extractVideoId();
        const effectiveVid = currentVideoId !== "unknown" ? currentVideoId : targetVideoId;
        if (effectiveVid && effectiveVid !== "unknown") {
          if (capturedTracksMap.has(effectiveVid) || videosWithCachedTrack.has(effectiveVid)) {
            return;
          }
        }
        console.log("[YT-Lang-AI] Fallback CC check for videoId:", effectiveVid);
        const activePlayer = document.querySelector("#movie_player") ?? document.querySelector("ytd-reel-video-renderer[is-active] #shorts-player") ?? document.querySelector("ytd-reel-video-renderer[is-active] .html5-video-player") ?? document.querySelector(".html5-video-player");
        if (activePlayer && !isCircuitBreakerActive()) {
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
      if (isCircuitBreakerActive()) {
        notifyRateLimited();
        return false;
      }
      try {
        const response = await originalFetch(urlObj.toString(), {
          credentials: "include"
        });
        if (response.status === 429) {
          console.warn("[YT-Lang-AI] HTTP 429 detected during fetchAndDispatchTrack!");
          triggerRateLimitCircuitBreaker();
          return false;
        }
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
      const response = await originalFetch(input, init);
      if (response.status === 429) {
        console.warn("[YT-Lang-AI] HTTP 429 detected on timedtext fetch!");
        triggerRateLimitCircuitBreaker();
        return response;
      }
      if (response.ok) {
        try {
          const cloned = response.clone();
          void cloned.text().then((text) => {
            handleCapturedText(timedtextUrl, text);
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
          if (this.status === 429) {
            console.warn("[YT-Lang-AI] HTTP 429 detected on timedtext XHR!");
            triggerRateLimitCircuitBreaker();
            return;
          }
          if (this.status < 200 || this.status >= 300) return;
          const isTranslated = Boolean(timedtextUrl.searchParams.get("tlang"));
          if (typeof this.responseText === "string" && this.responseText.length > 0) {
            handleCapturedText(timedtextUrl, this.responseText);
          } else if (this.response && typeof this.response === "object" && isJson3Data(this.response)) {
            dispatchCapturedTrack(buildPayload(timedtextUrl, this.response), isTranslated);
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
      if (data.type === "HAVE_CACHED_TRACK" && data.payload?.videoId) {
        videosWithCachedTrack.add(data.payload.videoId);
        cancelFallbackTimer();
        return;
      }
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
        } else if (!videosWithCachedTrack.has(requestedVid)) {
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
        const vid = data.payload.videoId;
        if (vid && videosWithCachedTrack.has(vid)) {
          cancelFallbackTimer();
          return;
        }
        scheduleFallbackActivation();
        return;
      }
      if (data.type === "REQUEST_TRANSLATED_TRACK" && data.payload) {
        if (isCircuitBreakerActive()) {
          notifyRateLimited();
          return;
        }
        const { nativeLang, videoId } = data.payload;
        const targetVid = videoId || extractVideoIdFromLocation();
        if (!targetVid) return;
        const transKey = `${targetVid}:${nativeLang.toLowerCase()}`;
        if (requestedTranslations.has(transKey)) {
          console.log("[YT-Lang-AI] Translation already requested for:", transKey);
          return;
        }
        let baseUrlStr = targetVid && videoBaseTimedtextMap.get(targetVid) || lastBaseTimedtextUrl;
        if (!baseUrlStr && targetVid && captionTracksCache.has(targetVid)) {
          const cachedTracks = captionTracksCache.get(targetVid);
          const preferred = cachedTracks?.find((t) => t.kind !== "asr") ?? cachedTracks?.[0];
          if (preferred?.baseUrl) {
            baseUrlStr = preferred.baseUrl;
          }
        }
        if (!baseUrlStr) {
          postToIsolated({
            source: MAIN_MESSAGE_SOURCE,
            type: "TRACK_ERROR",
            payload: { error: "No base timedtext track captured yet for translation" }
          });
          return;
        }
        requestedTranslations.add(transKey);
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
