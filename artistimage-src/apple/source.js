// Apple Music · 艺术家图片插件
//
// 从上游 Lyrico 的 Apple Music 插件里把「艺术家图」这一段单独拆出来。
// 保留的只有：开发者 token 获取（amp-api 必须要它）+ 一次 artists 搜索。
// 搜歌、歌词（TTML 本地化 / 第三方歌词）相关代码全部不带。
//
// 流程：
//   1. 拿 WebPlay 开发者 token：先看缓存，再抓 music.apple.com 首页里的 index js，
//      从里面正则出 kid=WebPlayKid / iss=AMPWebPlay / alg=ES256 的那个 JWT；
//   2. /v1/catalog/{storefront}/search?types=artists，取 attributes.artwork.url；
//   3. 把 arturl 里的 {w}/{h}/{f} 换成实际尺寸和后缀就是图片地址。

const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_LYRICO_USER_AGENT =
  "Lyrico/1.0 (github.com/Replica0110/Lyrico)";

const APPLE_LOG_TAG = "AppleSourcePlugin";

/** amp-api 的 Authorization 必须是 WebPlay 的开发者 token（这几个字段用来认它）。 */
const APPLE_WEBPLAY_KID = "WebPlayKid";
const APPLE_WEBPLAY_ISS = "AMPWebPlay";
const APPLE_DEVELOPER_TOKEN_CACHE_KEY = "apple.webplay.developer_token";
const APPLE_TOKEN_EXPIRY_SKEW_SECONDS = 60;

let cachedDeveloperToken = "";
let cachedLyricoUserAgent = "";

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

/** 用宿主自己的 UA 去请求 Apple：默认值只兜底，宿主给了就用宿主的。 */
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

/** 日志里只留前 N 个字符：首页和 index js 都是几 MB，整段打进去会把日志撑爆。 */
function previewText(text, limit) {
  return String(text || "").replace(/\s+/g, " ").slice(0, limit || 1200);
}

/** 读配置项，空值退回 fallback。 */
function configValue(request, key, fallback) {
  const config = request && request.config ? request.config : {};
  const value = config[key];

  if (value === undefined || value === null || value === "") {
    return fallback || "";
  }

  return value;
}

// ---------------------------------------------------------------------------
// 开发者 token
// ---------------------------------------------------------------------------

function hasAppleCache() {
  return Platform.cache && typeof Platform.cache.get === "function" && typeof Platform.cache.set === "function";
}

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

  // 过期时间晚的排前面，取第一个。
  result.sort(function (a, b) {
    return Number(b.payload.exp || 0) - Number(a.payload.exp || 0);
  });

  return result;
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

/** 拿开发者 token：内存 → 宿主缓存 → 抓首页和 index js。拿不到返回空串。 */
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

// ---------------------------------------------------------------------------
// 请求参数
// ---------------------------------------------------------------------------

/** 地区 → 店铺代码。 */
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

function appleRequestRegion(request) {
  return configValue(request, "region", "zh-CN");
}

/**
 * 兼容旧 manifest：
 * - 旧配置只有 region=zh-CN/en-US/...
 * - 新配置可以有 region=cn/us/... + language=zh-Hans/en-US/...
 */
function appleRequestLanguage(request) {
  const fallback = configValue(request, "region", "zh-CN");
  return configValue(request, "language", fallback);
}

// ---------------------------------------------------------------------------
// 艺术家图片
// ---------------------------------------------------------------------------

/** 从 request 里取艺术家名：优先 request.artist，其次 request.song.artist。 */
function appleArtistName(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

/** 名字是否算同一位艺术家：忽略大小写和空格，允许互相包含。 */
function appleArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/**
 * 搜艺术家图片。
 *
 * @param {Object} request 宿主下发的请求：{ artist, song: { artist }, pageSize, config }
 * @returns {Array} [{ id, name, imageUrl, internal }]
 */
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
      // artwork.url 是模板：{w}/{h} 尺寸，{f} 后缀。
      const artwork = attrs.artwork && attrs.artwork.url
        ? String(attrs.artwork.url).replace('{w}', size).replace('{h}', size).replace('{f}', 'jpg')
        : '';
      if (!artwork) return;
      out.push({ id: String(item.id || ''), name: String(attrs.name || ''), imageUrl: artwork, internal: {} });
    });
    // 名字对得上的排前面。
    out.sort(function (a, b) {
      return (appleArtistMatches(a.name, artist) ? 0 : 1) - (appleArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    warnApple('artist image search failed: ' + String(e && e.message ? e.message : e));
    return [];
  }
}
