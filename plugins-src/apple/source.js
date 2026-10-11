const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_LYRICO_USER_AGENT =
  "Lyrico/1.0 (github.com/Replica0110/Lyrico)";

const APPLE_LOG_TAG = "AppleSourcePlugin";

let cachedDeveloperToken = "";
let cachedLyricoUserAgent = "";
let cachedRuntimeInfo = null;

function logApple(message) {
  if (Platform.log && Platform.log.debug) {
    Platform.log.debug(APPLE_LOG_TAG, String(message));
  }
}

function warnApple(message) {
  if (Platform.log && Platform.log.warn) {
    Platform.log.warn(APPLE_LOG_TAG, String(message));
  }
}

function getLyricoUserAgent() {
  if (cachedLyricoUserAgent) {
    return cachedLyricoUserAgent;
  }

  try {
    if (Platform.app && Platform.app.getUserAgent) {
      cachedLyricoUserAgent = String(Platform.app.getUserAgent() || "").trim();
    } else if (typeof app !== "undefined" && app.getUserAgent) {
      cachedLyricoUserAgent = String(app.getUserAgent() || "").trim();
    }
  } catch (e) {
    warnApple("getUserAgent failed: " + String(e && e.message ? e.message : e));
  }

  if (!cachedLyricoUserAgent) {
    cachedLyricoUserAgent = DEFAULT_LYRICO_USER_AGENT;
  }

  return cachedLyricoUserAgent;
}

function previewText(text, limit) {
  return String(text || "").replace(/\s+/g, " ").slice(0, limit || 1200);
}

function configValue(request, key, fallback) {
  const config = request && request.config ? request.config : {};
  const value = config[key];

  if (value === undefined || value === null || value === "") {
    return fallback || "";
  }

  return value;
}

function getRuntimeInfoSafe() {
  if (cachedRuntimeInfo) {
    return cachedRuntimeInfo;
  }

  try {
    if (Platform.runtime && Platform.runtime.getInfo) {
      cachedRuntimeInfo = Platform.runtime.getInfo() || {};
      return cachedRuntimeInfo;
    }
  } catch (e) {
    warnApple("runtime.getInfo failed: " + String(e && e.message ? e.message : e));
  }

  cachedRuntimeInfo = {};
  return cachedRuntimeInfo;
}

function hasHostApi(name) {
  try {
    const info = getRuntimeInfoSafe();
    const apis = info.supportedHostApis || [];
    return apis.indexOf(name) >= 0;
  } catch (e) {
    return false;
  }
}

function hasXmlHostApi() {
  return !!(
    Platform.xml &&
    Platform.xml.getRootAttributes &&
    Platform.xml.findElements &&
    Platform.xml.replaceChildrenByAttr &&
    Platform.xml.removeElements &&
    hasHostApi("xml.getRootAttributes") &&
    hasHostApi("xml.findElements") &&
    hasHostApi("xml.replaceChildrenByAttr") &&
    hasHostApi("xml.removeElements")
  );
}

function storefront(region) {
  const value = String(region || "").trim();

  if (value === "cn" || value === "zh-CN" || value === "zh-Hans" || value === "zh-Hans-CN") return "cn";
  if (value === "us" || value === "en-US" || value === "en") return "us";
  if (value === "jp" || value === "ja-JP" || value === "ja") return "jp";
  if (value === "kr" || value === "ko-KR" || value === "ko") return "kr";
  if (value === "tr" || value === "tr-TR" || value === "tr") return "tr";
  if (value === "hk" || value === "zh-HK") return "hk";
  if (value === "tw" || value === "zh-TW" || value === "zh-Hant" || value === "zh-Hant-TW") return "tw";

  return "us";
}

function normalizeAppleLanguage(language) {
  const value = String(language || "").trim();

  if (!value) return "";

  if (value === "zh-CN" || value === "zh-Hans-CN") return "zh-Hans";
  if (value === "zh-TW" || value === "zh-HK" || value === "zh-Hant-TW" || value === "zh-Hant-HK") return "zh-Hant";
  if (value === "en-US" || value === "en-GB") return "en";
  if (value === "ja-JP") return "ja";
  if (value === "ko-KR") return "ko";
  if (value === "tr-TR") return "tr";

  return value;
}

function appleLanguageCandidates(language) {
  const value = String(language || "").trim();
  const normalized = normalizeAppleLanguage(value);

  if (normalized === "zh-Hans") {
    return ["zh-Hans", "zh-Hans-CN", "zh-CN"];
  }

  if (normalized === "zh-Hant") {
    return ["zh-Hant", "zh-Hant-TW", "zh-Hant-HK", "zh-TW", "zh-HK"];
  }

  if (normalized === "en") {
    return ["en", "en-US", "en-GB"];
  }

  if (normalized === "ja") {
    return ["ja", "ja-JP"];
  }

  if (normalized === "ko") {
    return ["ko", "ko-KR"];
  }

  if (normalized === "tr") {
    return ["tr", "tr-TR"];
  }

  return value ? [value] : [];
}

function appleLanguageFamily(language) {
  const normalized = normalizeAppleLanguage(language);

  if (normalized === "zh-Hans" || normalized === "zh-Hant") {
    return "zh";
  }

  if (normalized.indexOf("-") > 0) {
    return normalized.split("-")[0];
  }

  return normalized;
}

function isSameAppleLanguageFamily(left, right) {
  const a = appleLanguageFamily(left);
  const b = appleLanguageFamily(right);

  return !!a && !!b && a === b;
}

function shouldApplyAppleTranslationAsReplacement(type, sourceLanguage, translationLanguage) {
  const value = String(type || "").trim();

  if (value === "replacement") {
    return true;
  }

  if (value === "subtitle") {
    return false;
  }

  /*
   * Apple 有些中文 TTML 会把 zh-Hans 放在 translation 中但不标 type。
   * 这种只能在同语言族时当作本地化 replacement。
   * 不能把英文歌的 zh-Hans subtitle 当正文替换。
   */
  return isSameAppleLanguageFamily(sourceLanguage, translationLanguage);
}

function findAppleTranslations(ttml, language) {
  if (!hasXmlHostApi()) {
    warnApple("xml host api is unavailable, skip Apple TTML localization");
    return [];
  }

  const candidates = appleLanguageCandidates(language);
  const results = [];

  for (let i = 0; i < candidates.length; i++) {
    const lang = candidates[i];

    try {
      const items = Platform.xml.findElements(ttml, {
        tag: "translation",
        attrs: {
          "xml:lang": lang
        }
      }) || [];

      for (let j = 0; j < items.length; j++) {
        results.push(items[j]);
      }
    } catch (e) {
      warnApple(
        "xml.findElements translation failed language=" +
          lang +
          " error=" +
          String(e && e.message ? e.message : e)
      );
    }
  }

  return results;
}

function findBestAppleTranslation(ttml, language) {
  if (!hasXmlHostApi()) {
    return null;
  }

  let sourceLanguage = "";

  try {
    const rootAttrs = Platform.xml.getRootAttributes(ttml) || {};
    sourceLanguage = String(rootAttrs["xml:lang"] || rootAttrs.lang || "");
  } catch (e) {
    warnApple("xml.getRootAttributes failed: " + String(e && e.message ? e.message : e));
  }

  const translations = findAppleTranslations(ttml, language);

  for (let i = 0; i < translations.length; i++) {
    const item = translations[i] || {};
    const attrs = item.attrs || {};
    const lang = String(attrs["xml:lang"] || attrs.lang || "");
    const type = String(attrs.type || "");

    if (shouldApplyAppleTranslationAsReplacement(type, sourceLanguage, lang)) {
      return {
        node: item,
        sourceLanguage: sourceLanguage,
        language: lang,
        type: type
      };
    }
  }

  return null;
}

function appleTranslationToReplacementMap(translation) {
  const replacements = {};
  const children = (translation && translation.children) || [];

  for (let i = 0; i < children.length; i++) {
    const child = children[i] || {};

    if (child.tag !== "text") {
      continue;
    }

    const attrs = child.attrs || {};
    const key = String(attrs["for"] || "");

    if (!key) {
      continue;
    }

    const innerXml = String(child.innerXml || "");
    const text = String(child.text || "");

    if (innerXml.indexOf("<span") >= 0) {
      replacements[key] = {
        mode: "xml",
        value: innerXml
      };
    } else {
      replacements[key] = {
        mode: "text",
        value: text
      };
    }
  }

  return replacements;
}

function removeAppliedAppleReplacementTranslations(ttml, language, appliedTranslation) {
  if (!hasXmlHostApi() || !appliedTranslation) {
    return ttml;
  }

  const appliedLanguage = String(appliedTranslation.language || language || "");
  const appliedType = String(appliedTranslation.type || "");
  const sourceLanguage = String(appliedTranslation.sourceLanguage || "");

  /*
   * 如果是明确 type="replacement"，只删 replacement，不碰 subtitle。
   */
  if (appliedType === "replacement") {
    return Platform.xml.removeElements(ttml, {
      tag: "translation",
      attrs: {
        "xml:lang": appliedLanguage,
        type: "replacement"
      }
    });
  }

  /*
   * 如果 type 缺失，只在同语言族 replacement 且同语言下没有 subtitle 时，
   * 才删除这个语言的 translation，避免原文和翻译重复。
   */
  if (appliedType === "" && isSameAppleLanguageFamily(sourceLanguage, appliedLanguage)) {
    const sameLanguageTranslations = findAppleTranslations(ttml, appliedLanguage);
    let hasSubtitle = false;
    let hasNonApplicable = false;

    for (let i = 0; i < sameLanguageTranslations.length; i++) {
      const attrs = (sameLanguageTranslations[i] && sameLanguageTranslations[i].attrs) || {};
      const type = String(attrs.type || "");
      const lang = String(attrs["xml:lang"] || attrs.lang || "");

      if (type === "subtitle") {
        hasSubtitle = true;
      }

      if (!shouldApplyAppleTranslationAsReplacement(type, sourceLanguage, lang)) {
        hasNonApplicable = true;
      }
    }

    if (!hasSubtitle && !hasNonApplicable) {
      return Platform.xml.removeElements(ttml, {
        tag: "translation",
        attrs: {
          "xml:lang": appliedLanguage
        }
      });
    }
  }

  return ttml;
}

function applyAppleOfficialLocalizationToTtml(ttml, language) {
  let xml = String(ttml || "");

  if (!xml) {
    return "";
  }

  if (!hasXmlHostApi()) {
    return xml;
  }

  const translation = findBestAppleTranslation(xml, language);

  if (!translation) {
    return xml;
  }

  const replacements = appleTranslationToReplacementMap(translation.node);
  const keys = Object.keys(replacements);

  if (!keys.length) {
    return xml;
  }

  const outputLanguage = appleLanguageCandidates(language)[0] || String(language || "");

  try {
    xml = Platform.xml.replaceChildrenByAttr(xml, {
      targetTag: "p",
      keyAttr: "itunes:key",
      replacements: replacements,
      rootAttributes: outputLanguage
        ? {
            "xml:lang": outputLanguage
          }
        : {}
    });

    xml = removeAppliedAppleReplacementTranslations(xml, outputLanguage, translation);

    logApple(
      "official lyrics applied Apple localization language=" +
        outputLanguage +
        " sourceLanguage=" +
        String(translation.sourceLanguage || "") +
        " translationLanguage=" +
        String(translation.language || "") +
        " type=" +
        String(translation.type || "") +
        " count=" +
        String(keys.length)
    );

    return xml;
  } catch (e) {
    warnApple(
      "apply Apple TTML localization failed: " +
        String(e && e.message ? e.message : e)
    );
    return String(ttml || "");
  }
}

const APPLE_WEBPLAY_KID = "WebPlayKid";
const APPLE_WEBPLAY_ISS = "AMPWebPlay";
const APPLE_DEVELOPER_TOKEN_CACHE_KEY = "apple.webplay.developer_token";
const APPLE_TOKEN_EXPIRY_SKEW_SECONDS = 60;

function decodeJwtJson(part) {
  return JSON.parse(
    Platform.base64.decodeUrlText(part)
  );
}

function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    return {
      token: token,
      header: decodeJwtJson(parts[0]),
      payload: decodeJwtJson(parts[1]),
      signature: parts[2]
    };
  } catch (e) {
    return null;
  }
}

function isWebPlayDeveloperToken(jwt) {
  if (!jwt || !jwt.header || !jwt.payload) {
    return false;
  }

  const header = jwt.header;
  const payload = jwt.payload;
  const now = Math.floor(Date.now() / 1000);

  if (header.kid !== APPLE_WEBPLAY_KID) {
    return false;
  }

  if (payload.iss !== APPLE_WEBPLAY_ISS) {
    return false;
  }

  if (header.alg !== "ES256") {
    return false;
  }

  if (typeof payload.iat !== "number") {
    return false;
  }

  if (typeof payload.exp !== "number") {
    return false;
  }

  if (payload.exp <= now) {
    return false;
  }

  return true;
}

function findWebPlayDeveloperTokens(js) {
  const text = String(js || "");
  const regex = /(?:^|[^A-Za-z0-9_-])([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})(?![A-Za-z0-9_-])/g;

  const result = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const token = match[1];
    const jwt = parseJwt(token);

    if (isWebPlayDeveloperToken(jwt)) {
      result.push(jwt);
    }
  }

  result.sort(function (a, b) {
    return Number(b.payload.exp || 0) - Number(a.payload.exp || 0);
  });

  return result;
}

function hasAppleCache() {
  return Platform.cache && typeof Platform.cache.get === "function" && typeof Platform.cache.set === "function";
}

function getCachedDeveloperToken() {
  if (!hasAppleCache()) {
    warnApple("host cache API unavailable; developer token will not persist");
    return "";
  }

  const token = String(Platform.cache.get(APPLE_DEVELOPER_TOKEN_CACHE_KEY) || "").trim();
  if (!token) {
    logApple("developer token cache miss");
    return "";
  }

  const jwt = parseJwt(token);
  if (isWebPlayDeveloperToken(jwt)) {
    cachedDeveloperToken = token;
    logApple("developer token cache hit exp=" + String(jwt.payload.exp || ""));
    return token;
  }

  if (Platform.cache && typeof Platform.cache.remove === "function") {
    Platform.cache.remove(APPLE_DEVELOPER_TOKEN_CACHE_KEY);
  }
  warnApple("developer token cache invalid or expired; removed");
  return "";
}

function saveDeveloperToken(token) {
  if (!hasAppleCache()) return;

  const jwt = parseJwt(token);
  if (!isWebPlayDeveloperToken(jwt)) return;

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(jwt.payload.exp || 0) - now - APPLE_TOKEN_EXPIRY_SKEW_SECONDS;
  if (ttlSeconds <= 0) {
    warnApple("developer token cache skipped because ttlSeconds=" + String(ttlSeconds));
    return;
  }

  Platform.cache.set(APPLE_DEVELOPER_TOKEN_CACHE_KEY, token, ttlSeconds * 1000);
  logApple(
    "developer token cache saved exp=" +
      String(jwt.payload.exp || "") +
      " ttlSeconds=" +
      String(ttlSeconds)
  );
}

function getDeveloperToken() {
  if (cachedDeveloperToken) {
    const jwt = parseJwt(cachedDeveloperToken);
    if (isWebPlayDeveloperToken(jwt)) {
      return cachedDeveloperToken;
    }
    cachedDeveloperToken = "";
  }

  const cached = getCachedDeveloperToken();
  if (cached) {
    return cached;
  }

  const homeUrl = "https://music.apple.com";
  const home = Platform.http.getText(homeUrl, {
    headers: {
      "User-Agent": WEB_USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  logApple("home response length=" + String(home.length) + " preview=" + previewText(home, 500));

  let indexPath = "";

  const legacyMatch = String(home).match(/\/assets\/index-legacy[~\-][^"']+\.js/);
  const normalMatch = String(home).match(/\/assets\/index[~\-][^"']+\.js/);
  const betaMatch = String(home).match(/\/assets\/index~[^"']+\.js/);

  if (legacyMatch) {
    indexPath = legacyMatch[0];
  } else if (normalMatch) {
    indexPath = normalMatch[0];
  } else if (betaMatch) {
    indexPath = betaMatch[0];
  }

  if (!indexPath) {
    warnApple("index js path not found in home response");
    return "";
  }

  logApple("index js path=" + indexPath);

  const js = Platform.http.getText("https://music.apple.com" + indexPath, {
    headers: {
      "User-Agent": WEB_USER_AGENT,
      "Accept": "*/*",
      "Referer": "https://music.apple.com/"
    }
  });

  logApple("index js response length=" + String(js.length));

  const candidates = findWebPlayDeveloperTokens(js);

  logApple("webplay developer token candidates=" + String(candidates.length));

  if (candidates.length > 0) {
    const selected = candidates[0];

    cachedDeveloperToken = selected.token;
    saveDeveloperToken(cachedDeveloperToken);

    logApple(
      "developer token selected=true" +
        " kid=" + String(selected.header.kid) +
        " iss=" + String(selected.payload.iss) +
        " iat=" + String(selected.payload.iat) +
        " exp=" + String(selected.payload.exp) +
        " tokenLength=" + String(cachedDeveloperToken.length)
    );

    return cachedDeveloperToken;
  }

  warnApple("WebPlay developer token not found: kid=WebPlayKid iss=AMPWebPlay");
  cachedDeveloperToken = "";
  return "";
}

function appleGet(url, developerToken, mediaUserToken) {
  const headers = {
    "Authorization": "Bearer " + developerToken,
    "Origin": "https://music.apple.com",
    "Referer": "https://music.apple.com/",
    "User-Agent": getLyricoUserAgent(),
    "Accept": "application/json, text/plain, */*"
  };

  if (mediaUserToken) {
    headers["Cookie"] = "media-user-token=" + mediaUserToken;
  }

  return Platform.http.getText(url, {
    headers: headers
  });
}

function splitArtist(name, separator) {
  const value = String(name || "");
  const parts = value.split(/, | & /).filter(Boolean);
  return parts.length ? parts.join(separator || "/") : value;
}

function shouldAppendSpace(current, next) {
  if (!next) return false;

  const a = String(current || "").slice(-1);
  const b = String(next || "").charAt(0);

  return /[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b);
}

function decodeXmlText(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function stripXmlTags(text) {
  return decodeXmlText(String(text || "").replace(/<[^>]+>/g, ""));
}

function parseTtmlTimestampToMs(value) {
  const text = String(value || "").trim();
  if (!text) return 0;

  const msMatch = text.match(/^(\d+(?:\.\d+)?)ms$/);
  if (msMatch) {
    return Math.round(Number(msMatch[1]));
  }

  const secMatch = text.match(/^(\d+(?:\.\d+)?)s$/);
  if (secMatch) {
    return Math.round(Number(secMatch[1]) * 1000);
  }

  const hmsMatch = text.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (hmsMatch) {
    const h = Number(hmsMatch[1] || 0);
    const m = Number(hmsMatch[2] || 0);
    const s = Number(hmsMatch[3] || 0);
    const fraction = String(hmsMatch[4] || "");
    const ms = fraction ? Number("0." + fraction) * 1000 : 0;
    return Math.round(((h * 60 + m) * 60 + s) * 1000 + ms);
  }

  const msTimeMatch = text.match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
  if (msTimeMatch) {
    const m = Number(msTimeMatch[1] || 0);
    const s = Number(msTimeMatch[2] || 0);
    const fraction = String(msTimeMatch[3] || "");
    const ms = fraction ? Number("0." + fraction) * 1000 : 0;
    return Math.round((m * 60 + s) * 1000 + ms);
  }

  return 0;
}

function formatLrcTimestamp(ms) {
  const value = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.floor(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((value % 1000) / 10);

  return "[" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "." +
    String(centiseconds).padStart(2, "0") +
    "]";
}

function parseTtmlLines(ttml) {
  const xml = String(ttml || "");
  const lines = [];
  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let match;

  while ((match = pRegex.exec(xml)) !== null) {
    const attrs = match[1] || "";
    const inner = match[2] || "";

    const beginMatch = attrs.match(/\bbegin=["']([^"']+)["']/);
    const endMatch = attrs.match(/\bend=["']([^"']+)["']/);

    const start = beginMatch ? parseTtmlTimestampToMs(beginMatch[1]) : 0;
    const end = endMatch ? parseTtmlTimestampToMs(endMatch[1]) : start;
    const text = stripXmlTags(inner).trim();

    if (text) {
      lines.push([start, end, text]);
    }
  }

  return lines;
}

function ttmlToLrc(ttml) {
  return parseTtmlLines(ttml)
    .map(function(line) {
      return formatLrcTimestamp(line[0]) + line[2];
    })
    .join("\n");
}

// 艺术家图片：Apple Music。
// catalog 的 artist 资源带 attributes.artwork.url 模板，替换 {w}/{h}/{f} 即可取任意尺寸。
function appleArtistName(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

function appleArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

function searchArtistImages(request) {
  try {
    const developerToken = getDeveloperToken();
    if (!developerToken) {
      warnApple('artist image search aborted because developer token is empty');
      return [];
    }
    const artist = appleArtistName(request);
    if (!artist) return [];
    const region = appleRequestRegion(request);
    const language = appleRequestLanguage(request);
    const size = configValue(request, 'cover_size', '3000');
    var limit = Number(request.pageSize || 5);
    if (!isFinite(limit) || limit <= 0) limit = 5;
    if (limit > 25) limit = 25;
    const url = 'https://amp-api.music.apple.com/v1/catalog/' + storefront(region) + '/search'
      + '?term=' + encodeURIComponent(artist)
      + '&types=artists'
      + '&limit=' + encodeURIComponent(limit)
      + '&l=' + encodeURIComponent(language)
      + '&platform=web'
      + '&format[resources]=map';
    const raw = appleGet(url, developerToken, '');
    const root = JSON.parse(raw);
    const data = (((root.results || {}).artists || {}).data) || [];
    const resources = (((root.resources || {}).artists) || {});
    const out = [];
    data.forEach(function (entry) {
      const item = resources[String(entry.id || '')] || entry;
      const attrs = item.attributes || {};
      const artwork = attrs.artwork && attrs.artwork.url
        ? String(attrs.artwork.url).replace('{w}', size).replace('{h}', size).replace('{f}', 'jpg')
        : '';
      if (!artwork) return;
      out.push({ id: String(item.id || ''), name: String(attrs.name || ''), imageUrl: artwork, internal: {} });
    });
    out.sort(function (a, b) {
      return (appleArtistMatches(a.name, artist) ? 0 : 1) - (appleArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    warnApple('artist image search failed: ' + String(e && e.message ? e.message : e));
    return [];
  }
}

function mapSong(id, attrs, request) {
  const size = configValue(request, "cover_size", "3000");
  const url = String(attrs.url || "");

  const urlAppleId = (url.split("?i=")[1] || "").split("&")[0];
  const pathAppleId = url.substring(url.lastIndexOf("/") + 1);
  const appleId = String(id || urlAppleId || pathAppleId || "");

  const artwork = attrs.artwork && attrs.artwork.url
    ? String(attrs.artwork.url)
        .replace("{w}", size)
        .replace("{h}", size)
        .replace("{f}", "jpg")
    : "";

  const genres = Array.isArray(attrs.genreNames)
    ? attrs.genreNames.filter(Boolean).join(" / ")
    : "";

  const trackNumber = attrs.trackNumber == null ? "" : String(attrs.trackNumber);

  const fields = {
    title: String(attrs.name || ""),
    artist: splitArtist(attrs.artistName, request.separator),
    album: String(attrs.albumName || ""),
    date: String(attrs.releaseDate || ""),
    track_number: trackNumber,
    cover_url: artwork
  };

  const internal = {
    apple_id: appleId
  };

  if (attrs.composerName) {
    fields.composer = String(attrs.composerName);
  }

  if (genres) {
    fields.genre = genres;
  }

  if (attrs.discNumber != null) {
    fields.disc_number = String(attrs.discNumber);
  }

  if (attrs.playParams && attrs.playParams.id) {
    internal.play_params_id = String(attrs.playParams.id);
  }

  return {
    id: appleId,
    title: fields.title,
    artist: fields.artist,
    album: fields.album,
    duration: Number(attrs.durationInMillis || 0),
    date: fields.date,
    trackNumber: trackNumber,
    picUrl: artwork,
    fields: fields,
    internal: internal
  };
}

function appleRequestRegion(request) {
  return configValue(request, "region", "zh-CN");
}

function appleRequestLanguage(request) {
  /*
   * 兼容旧 manifest：
   * - 旧配置只有 region=zh-CN/en-US/...
   * - 新配置可以有 region=cn/us/... + language=zh-Hans/en-US/...
   */
  const fallback = configValue(request, "region", "zh-CN");
  return configValue(request, "language", fallback);
}

function searchSongs(request) {
  const developerToken = getDeveloperToken();

  if (!developerToken) {
    warnApple("search aborted because developer token is empty");
    return [];
  }

  const region = appleRequestRegion(request);
  const language = appleRequestLanguage(request);

  const offset = Math.max(
    0,
    (Number(request.page || 1) - 1) * Number(request.pageSize || 20)
  );

  const url = "https://amp-api.music.apple.com/v1/catalog/" + storefront(region) + "/search"
    + "?term=" + encodeURIComponent(request.keyword || "")
    + "&types=songs"
    + "&limit=" + encodeURIComponent(request.pageSize || 20)
    + "&offset=" + encodeURIComponent(offset)
    + "&l=" + encodeURIComponent(language)
    + "&platform=web"
    + "&format[resources]=map";

  logApple(
    "search request keyword=" +
      String(request.keyword || "") +
      " region=" +
      region +
      " language=" +
      language +
      " url=" +
      url
  );

  const raw = appleGet(url, developerToken, "");
  logApple("search response length=" + String(raw.length) + " preview=" + previewText(raw, 1500));

  const root = JSON.parse(raw);
  const data = (((root.results || {}).songs || {}).data || []);
  const resources = (((root.resources || {}).songs) || {});

  logApple(
    "search parsed dataCount=" +
      String(data.length) +
      " resourcesCount=" +
      String(Object.keys(resources).length)
  );

  const results = data
    .map(function(item) {
      return resources[String(item.id || "")] || item;
    })
    .filter(Boolean)
    .map(function(song) {
      return mapSong(song.id, song.attributes || {}, request);
    })
    .filter(function(song) {
      return song.title;
    });

  logApple("search mapped resultCount=" + String(results.length));
  return results;
}

function parseThirdPartyLyrics(rawJson, song) {
  const root = JSON.parse(rawJson);
  const content = Array.isArray(root.content) ? root.content : [];

  const original = content
    .map(function(line) {
      const start = Number(line.timestamp || 0);
      const end = Number(line.endtime || start);
      const textArray = Array.isArray(line.text) ? line.text : [];

      const words = textArray
        .map(function(word, index) {
          const text = String(word.text || "");
          const next = textArray[index + 1] ? String(textArray[index + 1].text || "") : "";

          return [
            Number(word.timestamp || start),
            Number(word.endtime || end),
            text + (shouldAppendSpace(text, next) ? " " : "")
          ];
        })
        .filter(function(word) {
          return word[2];
        });

      if (words.length) {
        return [start, end, words];
      }

      const text = String(line.plain || (typeof line.text === "string" ? line.text : ""));
      return text ? [start, end, text] : null;
    })
    .filter(Boolean);

  const track = root.track || {};

  const tags = {
    ti: String(track.name || song.title || ""),
    ar: String(track.artistName || song.artist || ""),
    al: String(track.albumName || song.album || "")
  };

  if (track.composerName) {
    tags.composer = String(track.composerName);
  }

  if (track.releaseDate) {
    tags.date = String(track.releaseDate);
  }

  const songwriters = (((root.metadata || {}).songwriters) || [])
    .filter(Boolean)
    .join(" / ");

  if (songwriters) {
    tags.lyricist = songwriters;
  }

  const rawPlainLrc = String(root.lrc || "");
  const rawEnhancedLrc = String(root.elrc || root.elrcMultiPerson || "");
  const rawTtml = String(root.ttmlContent || "");
  const rawMultiPersonEnhancedLrc = String(root.elrcMultiPerson || "");

  if (rawTtml) {
    return {
      type: "rawTtml",
      tags: tags,
      rawTtml: rawTtml
    };
  }

  if (rawMultiPersonEnhancedLrc) {
    return {
      type: "rawMultiPersonEnhancedLrc",
      tags: tags,
      rawMultiPersonEnhancedLrc: rawMultiPersonEnhancedLrc
    };
  }

  if (rawEnhancedLrc) {
    return {
      type: "rawEnhancedLrc",
      tags: tags,
      rawEnhancedLrc: rawEnhancedLrc
    };
  }

  if (rawPlainLrc && !original.length) {
    return {
      type: "rawPlainLrc",
      tags: tags,
      rawPlainLrc: rawPlainLrc
    };
  }

  return {
    type: "structured",
    tags: tags,
    original: original
  };
}

function parseOfficialLyrics(rawJson, fallbackSong, request) {
  const root = JSON.parse(rawJson);
  const song = ((root.data || [])[0]) || {};
  const attrs = song.attributes || {};
  const language = appleRequestLanguage(request);

  const official = getOfficialTtml(song, language);
  const ttml = applyAppleOfficialLocalizationToTtml(official.ttml, language);

  if (!ttml) {
    warnApple(
      "official lyrics ttml is empty. relationship keys=" +
      Object.keys(song.relationships || {}).join(",") +
      ", hasLyrics=" + String(attrs.hasLyrics) +
      ", hasTimeSyncedLyrics=" + String(attrs.hasTimeSyncedLyrics)
    );
    return null;
  }

  const tags = {
    ti: String(attrs.name || fallbackSong.title || ""),
    ar: String(attrs.artistName || fallbackSong.artist || ""),
    al: String(attrs.albumName || fallbackSong.album || "")
  };

  if (attrs.composerName) tags.composer = String(attrs.composerName);
  if (attrs.releaseDate) tags.date = String(attrs.releaseDate);

  return {
    type: "rawTtml",
    tags: tags,
    rawTtml: ttml,
    source: official.relationship
  };
}

function getThirdPartyLyrics(request, appleId, song) {
  const url = "https://lyrics.paxsenix.org/apple-music/lyrics"
    + "?id=" + encodeURIComponent(appleId)
    + "&ttml=false";

  const body = Platform.http.getText(url, {
    headers: {
      "accept": "application/json",
      "User-Agent": getLyricoUserAgent()
    }
  });

  logApple(
    "third-party lyrics response appleId=" +
      appleId +
      " length=" +
      String(body.length) +
      " preview=" +
      previewText(body, 1500)
  );

  return parseThirdPartyLyrics(body, song);
}

function pickTtmlLocalization(attrs, language) {
  const value = attrs.ttmlLocalizations;
  const candidates = appleLanguageCandidates(language);

  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    let fallback = "";

    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const locale = getLocalizationLocale(item);
      const ttml = extractTtmlFromLocalizationItem(item);

      if (!ttml) {
        continue;
      }

      if (candidates.indexOf(locale) >= 0) {
        return ttml;
      }

      if (!fallback) {
        fallback = ttml;
      }
    }

    return fallback;
  }

  if (typeof value === "object") {
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      if (value[candidate]) {
        const directTarget = extractTtmlFromLocalizationItem(value[candidate]);
        if (directTarget) {
          return directTarget;
        }
      }
    }

    const direct = extractTtmlFromLocalizationItem(value);
    if (direct) {
      return direct;
    }

    const keys = Object.keys(value);
    let fallback = "";

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const ttml = extractTtmlFromLocalizationItem(value[key]);

      if (!ttml) {
        continue;
      }

      if (candidates.indexOf(key) >= 0) {
        return ttml;
      }

      if (!fallback) {
        fallback = ttml;
      }
    }

    return fallback;
  }

  return "";
}

function getLocalizationLocale(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  return String(
    item.locale ||
    item.language ||
    item.languageTag ||
    item.lang ||
    item.id ||
    ""
  );
}

function extractTtmlFromLocalizationItem(item) {
  if (!item) {
    return "";
  }

  if (typeof item === "string") {
    return item;
  }

  if (typeof item !== "object") {
    return "";
  }

  return String(
    item.ttml ||
    item.ttmlContent ||
    item.lyrics ||
    item.value ||
    ""
  );
}

function getOfficialTtml(song, language) {
  const relationships = song.relationships || {};
  const preferredKeys = ["syllable-lyrics", "lyrics"];

  for (let i = 0; i < preferredKeys.length; i++) {
    const key = preferredKeys[i];
    const rel = relationships[key] || {};
    const data = rel.data || [];

    if (!data.length) continue;

    const attrs = data[0].attributes || {};

    const localizedTtml = pickTtmlLocalization(attrs, language);
    if (localizedTtml) {
      logApple("official lyrics using relationship=" + key + " field=ttmlLocalizations");
      return {
        relationship: key,
        field: "ttmlLocalizations",
        ttml: localizedTtml
      };
    }

    const ttml = String(
      attrs.ttml ||
      attrs.ttmlContent ||
      attrs.lyrics ||
      ""
    );

    if (ttml) {
      logApple("official lyrics using relationship=" + key + " field=ttml");
      return {
        relationship: key,
        field: "ttml",
        ttml: ttml
      };
    }
  }

  return {
    relationship: "",
    field: "",
    ttml: ""
  };
}

function getOfficialLyrics(request, appleId, song) {
  const developerToken = getDeveloperToken();

  if (!developerToken) {
    warnApple("official lyrics aborted because developer token is empty");
    return null;
  }

  const mediaUserToken = String(configValue(request, "media_user_token", "") || "").trim();

  if (!mediaUserToken) {
    warnApple("official lyrics aborted because media-user-token is empty");
    return null;
  }

  const region = appleRequestRegion(request);
  const language = appleRequestLanguage(request);

  const url = "https://amp-api.music.apple.com/v1/catalog/" + storefront(region) + "/songs/" + encodeURIComponent(appleId)
    + "?include=syllable-lyrics,lyrics"
    + "&extend=ttmlLocalizations"
    + "&l=" + encodeURIComponent(language)
    + "&platform=web";

  logApple(
    "official lyrics request appleId=" +
      appleId +
      " region=" +
      region +
      " language=" +
      language +
      " url=" +
      url
  );

  const raw = appleGet(url, developerToken, mediaUserToken);

  logApple(
    "official lyrics response appleId=" +
      appleId +
      " length=" +
      String(raw.length) +
      " preview=" +
      previewText(raw, 1500)
  );

  return parseOfficialLyrics(raw, song, request);
}
