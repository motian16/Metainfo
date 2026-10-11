const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.3.203419";

const AES_163_KEY = "#14ljk_!\\]&0U<'(";
const EAPI_KEY = "e82ckenh8dichen8";
const APP_VER = "3.1.3.203419";
const DEVICEID_XOR_KEY = "3go8&$8*3*3h0k(2)2";
const NE_CACHE_KEY = "netease.anonymous.session";
const NE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

let DEVICE_ID = randomHex(32);
let CLIENT_SIGN = generateClientSign();
let neInitialized = false;
let cookieJar = {};
let neCacheDirty = false;
let neOsVer = "Microsoft-Windows-10--build-" + randomIntRange(20000, 30000) + "-64bit";
let neMode = randomItem([
  "MS-iCraft B760M WIFI",
  "ASUS ROG STRIX Z790",
  "MSI MAG B550 TOMAHAWK",
  "ASRock X670E Taichi",
  "GIGABYTE Z790 AORUS ELITE"
]);

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

function randomIntRange(min, max) {
  return min + randomInt(max - min);
}

function randomItem(items) {
  return items[randomInt(items.length)];
}

function randomHex(length) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars.charAt(randomInt(chars.length));
  }
  return out;
}

function randomUpper(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars.charAt(randomInt(chars.length));
  }
  return out;
}

function randomLower(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars.charAt(randomInt(chars.length));
  }
  return out;
}

function randomMac() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(randomInt(256).toString(16).padStart(2, "0").toUpperCase());
  }
  return parts.join(":");
}

function generateClientSign() {
  return randomMac() + "@@@" + randomUpper(8) + "@@@@@@" + randomHex(64);
}

function mergeObjects(a, b) {
  const out = {};
  Object.keys(a || {}).forEach(function (key) {
    out[key] = a[key];
  });
  Object.keys(b || {}).forEach(function (key) {
    out[key] = b[key];
  });
  return out;
}

function cookieString(extraCookies) {
  const merged = mergeObjects(cookieJar, extraCookies || {});
  return Object.keys(merged)
    .filter(function (key) {
      return merged[key] != null && String(merged[key]).length > 0;
    })
    .map(function (key) {
      return key + "=" + merged[key];
    })
    .join("; ");
}

function setCookieFromHeaders(headers) {
  if (!headers) return false;

  const setCookies =
    headers["Set-Cookie"] ||
    headers["set-cookie"] ||
    headers["SET-COOKIE"] ||
    [];

  const list = Array.isArray(setCookies) ? setCookies : [String(setCookies)];
  const changedKeys = [];

  list.forEach(function (line) {
    if (!line) return;

    const first = String(line).split(";")[0];
    const index = first.indexOf("=");
    if (index <= 0) return;

    const key = first.slice(0, index).trim();
    const value = first.slice(index + 1).trim();

    if (key && value) {
      if (cookieJar[key] !== value) {
        changedKeys.push(key);
      }
      cookieJar[key] = value;
    }
  });

  if (changedKeys.length > 0) {
    neCacheDirty = true;
    Platform.log.debug("NE", "Response Set-Cookie changed keys=" + changedKeys.join(","));
    return true;
  }

  return false;
}

function hasHostCache() {
  return Platform.cache && typeof Platform.cache.get === "function" && typeof Platform.cache.set === "function";
}

function loadNeCache() {
  if (!hasHostCache()) {
    Platform.log.warn("NE", "Host cache API unavailable; anonymous login will not persist");
    return false;
  }

  const text = Platform.cache.get(NE_CACHE_KEY);
  if (!text) {
    Platform.log.debug("NE", "Anonymous session cache miss");
    return false;
  }

  try {
    const state = JSON.parse(text);
    const cookies = state && state.cookies ? state.cookies : {};
    if (!cookies || Object.keys(cookies).length === 0) {
      Platform.log.warn("NE", "Anonymous session cache has no cookies; ignoring");
      return false;
    }

    DEVICE_ID = String(state.deviceId || cookies.deviceId || DEVICE_ID);
    CLIENT_SIGN = String(state.clientSign || cookies.clientSign || CLIENT_SIGN);
    neOsVer = String(state.osver || cookies.osver || neOsVer);
    neMode = String(state.mode || cookies.mode || neMode);

    cookieJar = {};
    Object.keys(cookies).forEach(function (key) {
      if (cookies[key] != null && String(cookies[key]).length > 0) {
        cookieJar[key] = String(cookies[key]);
      }
    });

    return Object.keys(cookieJar).length > 0;
  } catch (e) {
    Platform.log.warn(
      "NE",
      "Anonymous session cache invalid; clearing: " + String(e && e.message ? e.message : e)
    );
    Platform.cache.remove(NE_CACHE_KEY);
    return false;
  }
}

function saveNeCache() {
  if (!hasHostCache()) return;

  Platform.cache.set(
    NE_CACHE_KEY,
    JSON.stringify({
      deviceId: DEVICE_ID,
      clientSign: CLIENT_SIGN,
      osver: neOsVer,
      mode: neMode,
      cookies: cookieJar || {}
    }),
    NE_CACHE_TTL_MS
  );
  neCacheDirty = false;
  Platform.log.debug(
    "NE",
    "Anonymous session cache saved ttlMs=" +
      String(NE_CACHE_TTL_MS) +
      ", cookies=" +
      Object.keys(cookieJar || {}).join(",")
  );
}

function clearNeCache() {
  if (Platform.cache && typeof Platform.cache.remove === "function") {
    Platform.cache.remove(NE_CACHE_KEY);
    neCacheDirty = false;
    Platform.log.debug("NE", "Anonymous session cache cleared");
  }
}

/*
 * UTF-8 编码。
 * 这里不能把 XOR 后的字符串丢给宿主 md5(text)，因为字符串里可能有 NUL / 控制字符。
 */
function utf8Bytes(str) {
  const bytes = [];

  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);

    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }

    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(
        0xc0 | (code >> 6),
        0x80 | (code & 0x3f)
      );
    } else if (code <= 0xffff) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  return bytes;
}

function base64EncodeBytes(bytes) {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] & 0xff;
    const b1 = i + 1 < bytes.length ? bytes[i + 1] & 0xff : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] & 0xff : 0;

    const triple = (b0 << 16) | (b1 << 8) | b2;

    out += table[(triple >> 18) & 0x3f];
    out += table[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? table[(triple >> 6) & 0x3f] : "=";
    out += i + 2 < bytes.length ? table[triple & 0x3f] : "=";
  }

  return out;
}

function leftRotate(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function md5Bytes(inputBytes) {
  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];

  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
  ];

  const bytes = inputBytes.slice();
  const bitLength = bytes.length * 8;

  bytes.push(0x80);

  while ((bytes.length % 64) !== 56) {
    bytes.push(0);
  }

  let lengthLow = bitLength >>> 0;
  let lengthHigh = Math.floor(bitLength / 4294967296) >>> 0;

  for (let i = 0; i < 4; i++) {
    bytes.push((lengthLow >>> (8 * i)) & 0xff);
  }

  for (let i = 0; i < 4; i++) {
    bytes.push((lengthHigh >>> (8 * i)) & 0xff);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const m = [];

    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      m[i] =
        (bytes[j] & 0xff) |
        ((bytes[j + 1] & 0xff) << 8) |
        ((bytes[j + 2] & 0xff) << 16) |
        ((bytes[j + 3] & 0xff) << 24);
      m[i] >>>= 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;

      if (i < 16) {
        f = ((b & c) | ((~b) & d)) >>> 0;
        g = i;
      } else if (i < 32) {
        f = ((d & b) | ((~d) & c)) >>> 0;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = (b ^ c ^ d) >>> 0;
        g = (3 * i + 5) % 16;
      } else {
        f = (c ^ (b | (~d))) >>> 0;
        g = (7 * i) % 16;
      }

      const temp = d;
      d = c;
      c = b;

      const sum = (a + f + k[i] + m[g]) >>> 0;
      b = (b + leftRotate(sum, s[i])) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = [];

  [a0, b0, c0, d0].forEach(function (word) {
    digest.push(word & 0xff);
    digest.push((word >>> 8) & 0xff);
    digest.push((word >>> 16) & 0xff);
    digest.push((word >>> 24) & 0xff);
  });

  return digest;
}

function md5HexFromBytes(bytes) {
  return md5Bytes(bytes)
    .map(function (b) {
      return (b & 0xff).toString(16).padStart(2, "0");
    })
    .join("");
}

function getAnonimousUsername(deviceId) {
  let xored = "";

  for (let i = 0; i < deviceId.length; i++) {
    const left = deviceId.charCodeAt(i);
    const right = DEVICEID_XOR_KEY.charCodeAt(i % DEVICEID_XOR_KEY.length);
    xored += String.fromCharCode(left ^ right);
  }

  const md5Digest = md5Bytes(utf8Bytes(xored));
  const base64Md5 = base64EncodeBytes(md5Digest);
  const combined = deviceId + " " + base64Md5;

  return base64EncodeBytes(utf8Bytes(combined));
}

function buildEapiParams(path, params, encryptPath, headerCookies) {
  headerCookies = headerCookies || {};

  const header = {
    clientSign: headerCookies.clientSign || CLIENT_SIGN,
    osver: headerCookies.osver || neOsVer,
    deviceId: headerCookies.deviceId || DEVICE_ID,
    os: headerCookies.os || "pc",
    appver: headerCookies.appver || APP_VER,
    requestId: String(Date.now())
  };

  const finalParams = {};
  Object.keys(params || {}).forEach(function (key) {
    finalParams[key] = params[key];
  });

  finalParams.header = JSON.stringify(header);

  if (finalParams.e_r == null) {
    finalParams.e_r = true;
  }

  const actualEncryptPath = encryptPath || path.replace("/eapi/", "/api/");
  const paramsText = JSON.stringify(finalParams);

  const digest = Platform.crypto.md5(
    "nobody" + actualEncryptPath + "use" + paramsText + "md5forencrypt"
  );

  const data =
    actualEncryptPath +
    "-36cd479b6b5-" +
    paramsText +
    "-36cd479b6b5-" +
    digest;

  return Platform.crypto.aesEcbPkcs5EncryptHex(data, EAPI_KEY);
}

function decryptEapiResponseBase64(base64) {
  if (!base64) return "";
  return Platform.crypto.aesEcbPkcs5DecryptBase64ToText(base64, EAPI_KEY);
}

function eapiRequestRaw(path, params, options) {
  options = options || {};

  if (!Platform.http || typeof Platform.http.postBytesResponse !== "function") {
    throw new Error(
      "Host API missing: Platform.http.postBytesResponse. " +
        "Update QuickJsRuntime.HOST_API_BOOTSTRAP and QuickJsHostApi."
    );
  }

  const headerCookies = options.headerCookies || options.cookies || {};

  const encryptedHex = buildEapiParams(
    path,
    params || {},
    options.encryptPath,
    headerCookies
  );

  const formBody = "params=" + encryptedHex;

  const response = Platform.http.postBytesResponse(
    "https://interface.music.163.com" + path,
    formBody,
    {
      contentType: "application/x-www-form-urlencoded",
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": "https://music.163.com/",
        "Accept": "*/*",
        "Host": "interface.music.163.com",
        "Cookie": cookieString(options.cookies || {})
      },
      connectTimeoutMs: options.connectTimeoutMs || 8000,
      readTimeoutMs: options.readTimeoutMs || 12000
    }
  );

  setCookieFromHeaders(response.headers);

  const bodyBase64 = response.bodyBase64 || "";
  const decrypted = decryptEapiResponseBase64(bodyBase64);

  if (!decrypted) {
    throw new Error(
      "Empty EAPI response: path=" +
        path +
        ", http=" +
        response.code +
        ", message=" +
        (response.message || "")
    );
  }

  return decrypted;
}

function buildPreCookies() {
  return {
    os: "pc",
    deviceId: DEVICE_ID,
    osver: neOsVer,
    clientSign: CLIENT_SIGN,
    channel: "netease",
    mode: neMode,
    appver: APP_VER
  };
}

function ensureNeInit() {
  if (neInitialized) return;

  if (loadNeCache()) {
    neCacheDirty = false;
    neInitialized = true;
    Platform.log.debug(
      "NE",
      "Anonymous session cache hit, cookies=" + Object.keys(cookieJar).join(",")
    );
    return;
  }

  const preCookies = buildPreCookies();

  cookieJar = {};
  Object.keys(preCookies).forEach(function (key) {
    cookieJar[key] = preCookies[key];
  });

  const username = getAnonimousUsername(DEVICE_ID);

  const raw = eapiRequestRaw(
    "/eapi/register/anonimous",
    {
      username: username,
      e_r: true
    },
    {
      cookies: preCookies,
      headerCookies: preCookies
    }
  );

  let root;
  try {
    root = JSON.parse(raw);
  } catch (e) {
    throw new Error("NE anonymous login invalid JSON: " + raw.slice(0, 300));
  }

  if (String(root.code) !== "200") {
    throw new Error(
      "NE anonymous login failed: " +
        raw.slice(0, 300) +
        ", usernameLength=" +
        username.length +
        ", username=" +
        username +
        ", deviceId=" +
        DEVICE_ID +
        ", osver=" +
        neOsVer +
        ", mode=" +
        neMode
    );
  }

  if (!cookieJar.WNMCID) {
    cookieJar.WNMCID = randomLower(6) + "." + Date.now() + ".01.0";
  }

  neInitialized = true;
  neCacheDirty = true;
  saveNeCache();

  Platform.log.debug(
    "NE",
    "Anonymous login ok, userId=" +
      String(root.userId || "") +
      ", cookies=" +
      Object.keys(cookieJar).join(",")
  );
}
function eapiRequest(path, params, encryptPath) {
  try {
    ensureNeInit();
  } catch (e) {
    Platform.log.warn(
      "NE",
      "Anonymous login failed, continue with current cookies: " +
        String(e && e.message ? e.message : e)
    );

    if (!cookieJar || Object.keys(cookieJar).length === 0) {
      const preCookies = buildPreCookies();
      cookieJar = {};
      Object.keys(preCookies).forEach(function (key) {
        cookieJar[key] = preCookies[key];
      });
    }
  }

  const raw = eapiRequestRaw(path, params || {}, {
    encryptPath: encryptPath,
    cookies: cookieJar,
    headerCookies: cookieJar
  });

  let root;
  try {
    root = JSON.parse(raw);
  } catch (e) {
    throw new Error("EAPI invalid JSON: path=" + path + ", raw=" + raw.slice(0, 300));
  }

  if (String(root.code) === "301" || String(root.code) === "401") {
    neInitialized = false;
    cookieJar = {};
    clearNeCache();
    throw new Error("NE session invalid: " + raw.slice(0, 300));
  }

  if (neCacheDirty) {
    saveNeCache();
  } else {
    Platform.log.debug("NE", "Anonymous session cache unchanged; skip save");
  }

  return root;
}

function postForm(url, params) {
  const body = Object.keys(params || {})
    .map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key]));
    })
    .join("&");

  const text = Platform.http.postText(url, body, {
    contentType: "application/x-www-form-urlencoded; charset=utf-8",
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": "https://music.163.com/"
    }
  });

  return JSON.parse(text);
}

function getJson(url) {
  const text = Platform.http.getText(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": "https://music.163.com/"
    }
  });

  return JSON.parse(text);
}

function formatDate(millis) {
  const value = Number(millis || 0);
  if (!value) return "";

  const d = new Date(value);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return d.getFullYear() + "-" + month + "-" + day;
}

function parseTimeMs(min, sec, fraction) {
  const ms = String(fraction || "0").padEnd(3, "0").slice(0, 3);
  return (Number(min) * 60 + Number(sec)) * 1000 + Number(ms);
}

function compactWordText(words) {
  return (Array.isArray(words) ? words : [])
    .map(function (word) {
      return Array.isArray(word) ? String(word[2] || "") : String(word || "");
    })
    .join("");
}

function parseLrc(text) {
  const timed = [];

  String(text || "").split(/\r?\n/).forEach(function (line) {
    const matches = [];
    const timeRe = /\[(\d{1,}):(\d{2})(?:[.:](\d{1,3}))?]/g;
    let timeMatch;

    while ((timeMatch = timeRe.exec(line)) !== null) {
      matches.push(timeMatch);
    }

    if (!matches.length) return;

    const last = matches[matches.length - 1];
    const content = line.slice(last.index + last[0].length).trim();

    if (!content) return;

    matches.forEach(function (match) {
      const start = parseTimeMs(match[1], match[2], match[3]);
      timed.push([start, content]);
    });
  });

  timed.sort(function (a, b) {
    return a[0] - b[0];
  });

  return timed.map(function (line, index) {
    const end = timed[index + 1]
      ? Math.max(line[0], timed[index + 1][0] - 10)
      : line[0] + 3000;

    return [line[0], end, line[1]];
  });
}

function parseYrc(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(function (line) {
      const match = line.trim().match(/^\[(\d+),(\d+)](.*)$/);
      if (!match) return null;

      const start = Number(match[1] || 0);
      const end = start + Number(match[2] || 0);
      const content = match[3] || "";
      const words = [];

      let wordMatch;
      const wordRe = /\((\d+),(\d+),\d+\)([^()]*)/g;

      while ((wordMatch = wordRe.exec(content)) !== null) {
        const wordStart = Number(wordMatch[1] || 0);
        const wordEnd = wordStart + Number(wordMatch[2] || 0);
        const textValue = wordMatch[3] || "";

        words.push([wordStart, wordEnd, textValue]);
        
      }

      if (!words.length && content) {
        words.push([start, end, content]);
      }

      if (!words.length) return null;

      words.sort(function (a, b) {
        return Number(a[0] || 0) - Number(b[0] || 0);
      });

      return [start, end, words];
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a[0] - b[0];
    });
}

function parseRichJsonLyrics(text) {
  const items = String(text || "")
    .split(/\r?\n/)
    .map(function (line) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.charAt(0) !== "{") return null;

      try {
        const obj = JSON.parse(trimmed);
        const start = Number(obj.t || 0);
        const parts = Array.isArray(obj.c)
          ? obj.c.map(function (item) {
              return String(item.tx || "");
            }).filter(Boolean)
          : [];
        const textValue = parts.join("").trim();

        if (!textValue) return null;
        return { start: start, text: textValue };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.start - b.start;
    });

  return buildLineLevelLines(items);
}

function parseMixedNeteaseLyrics(text) {
  const items = [];

  String(text || "").split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.charAt(0) === "{") {
      try {
        const obj = JSON.parse(trimmed);
        const parts = Array.isArray(obj.c)
          ? obj.c.map(function (item) {
              return String(item.tx || "");
            }).filter(Boolean)
          : [];
        const textValue = parts.join("").trim();
        const start = Number(obj.t || 0);

        items.push({ start: start, text: textValue });
        
      } catch (e) {
        // ignore malformed rich line
      }
      return;
    }

    const matches = [];
    const timeRe = /\[(\d{1,}):(\d{2})(?:[.:](\d{1,3}))?]/g;
    let timeMatch;

    while ((timeMatch = timeRe.exec(trimmed)) !== null) {
      matches.push(timeMatch);
    }

    if (!matches.length) return;

    const last = matches[matches.length - 1];
    const content = trimmed.slice(last.index + last[0].length).trim();

    if (!content) return;

    matches.forEach(function (match) {
      const start = parseTimeMs(match[1], match[2], match[3]);
      items.push({ start: start, text: content });
    });
  });

  return buildLineLevelLines(
    items.sort(function (a, b) {
      return a.start - b.start;
    })
  );
}

function buildLineLevelLines(items) {
  return items
    .map(function (line, index) {
      const nextStart = items[index + 1] ? items[index + 1].start : line.start + 3000;
      const end = Math.max(line.start, nextStart - 10);
      const text = String(line.text || "").trim();

      return text ? [line.start, end, [[line.start, end, text]]] : null;
    })
    .filter(Boolean);
}

function parseNeteaseOriginalLyrics(yrc, lrc) {
  if (yrc) {
    const yrcLines = parseYrc(yrc);
    if (yrcLines.length) return yrcLines;
  }

  if (/^\s*\{"/m.test(String(lrc || ""))) {
    return parseMixedNeteaseLyrics(lrc);
  }

  return parseLrc(lrc).map(function (line) {
    return [line[0], line[1], [[line[0], line[1], line[2]]]];
  });
}

function hasRichJsonLyrics(text) {
  return /^\s*\{"/m.test(String(text || ""));
}

function hasWordByWordLines(lines) {
  return (Array.isArray(lines) ? lines : []).some(function (line) {
    return Array.isArray(line[2]) && line[2].length > 1;
  });
}

function extractLineText(line) {
  const content = line[2];
  if (Array.isArray(content)) {
    return content.map(function (word) {
      return Array.isArray(word) ? String(word[2] || "") : String(word || "");
    }).join("");
  }
  return String(content || "");
}

function lyricsMerge(originalLines, textLines) {
  if (!Array.isArray(originalLines) || !Array.isArray(textLines) || !textLines.length) {
    return [];
  }

  const sortedTextLines = textLines
    .slice()
    .sort(function (a, b) {
      return Number(a[0] || 0) - Number(b[0] || 0);
    });

  const aligned = [];
  let textIndex = 0;

  for (let i = 0; i < originalLines.length; i++) {
    const original = originalLines[i];
    const winStart = Number(original[0] || 0);
    const winEnd =
      i < originalLines.length - 1
        ? Number(originalLines[i + 1][0] || winStart)
        : Number.MAX_SAFE_INTEGER;

    let matchedText = "";

    while (textIndex < sortedTextLines.length) {
      const textLine = sortedTextLines[textIndex];
      const textStart = Number(textLine[0] || 0);

      if (textStart < winStart - 500) {
        textIndex++;
        continue;
      }

      if (textStart >= winEnd) {
        break;
      }

      matchedText = extractLineText(textLine);
      textIndex++;
      break;
    }

    if (matchedText) {
      aligned.push([
        winStart,
        Number(original[1] || winStart),
        matchedText
      ]);
    } else {
      aligned.push([
        winStart,
        Number(original[1] || winStart),
        ""
      ]);
    }
  }

  return aligned;
}

// 艺术家图片：网易云。用公开的艺术家搜索接口拿 img1v1Url / picUrl，
// 去掉 ?param 缩放参数后就是原图（实测原图约 1280x1040）。
const NE_ARTIST_SEARCH_URL = 'https://music.163.com/api/search/get';

function neArtistName(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

/**
 * 网易的图片地址常带 ?param=180y180 这类缩放参数，**去掉就是原图**。
 * 拼 ?param=1024y1024 反而只是服务端裁出来的方图，不是最大分辨率。
 */
function neOriginalImageUrl(url) {
  const s = String(url == null ? '' : url).trim();
  const index = s.indexOf('?');
  return index >= 0 ? s.slice(0, index) : s;
}

function neArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

function searchArtistImages(request) {
  try {
    const artist = neArtistName(request);
    if (!artist) return [];
    // 接口按文档：music.163.com/api/search/get?s=<关键词>&type=100
    // type=100 就是"搜歌手"，返回 result.artists[]。
    const url = NE_ARTIST_SEARCH_URL + '?s=' + encodeURIComponent(artist) + '&type=100&limit=8&offset=0';
    const root = getJson(url);
    const artists = ((root.result || {}).artists) || [];
    const out = [];
    artists.forEach(function (item) {
      // img1v1Url 是 1:1 歌手头像，优先；缺失才退回 picUrl。
      const urls = [];
      [item.img1v1Url, item.picUrl].forEach(function (value) {
        // 原图 = 去掉 ?param=xxx 缩放参数。
        // **不要**追加 ?param=500y500 —— 那是让服务端裁一张 500x500 的方图，
        // 反而比原图小。
        const base = neOriginalImageUrl(value);
        if (base && urls.indexOf(base) < 0) urls.push(base);
      });
      if (!urls.length) return;
      out.push({
        id: String(item.id || ''),
        name: String(item.name || ''),
        imageUrl: urls[0],
        imageUrls: urls,
        internal: {}
      });
    });
    out.sort(function (a, b) {
      return (neArtistMatches(a.name, artist) ? 0 : 1) - (neArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    Platform.log.error('网易云音乐', Platform.i18n.t('error.artistImages', String(e && e.message ? e.message : e)));
    return [];
  }
}

function firstPositiveNumber(values) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const number = value == null ? 0 : Number(value);
    if (number > 0) return number;
  }
  return 0;
}

function getArtists(song) {
  if (Array.isArray(song.artists)) return song.artists;
  if (Array.isArray(song.ar)) return song.ar;
  return [];
}

function getAlbum(song) {
  return song.album || song.al || {};
}

function getAliases(song) {
  if (Array.isArray(song.alias)) return song.alias;
  if (Array.isArray(song.alia)) return song.alia;
  return [];
}

function getSongDuration(song) {
  return Number(song.duration || song.dt || 0);
}

function getTrackNumber(song) {
  return String(song.no || song.trackNumber || song.trackerNumber || "");
}
function getDiscNumber(song) {
  return String(song.cd || "");
}
function getPublishTime(song) {
  const album = getAlbum(song);
  return firstPositiveNumber([
    song.publishTime,
    song.publishTimeMs,
    album.publishTime,
    album.publishTimeMs
  ]);
}

function getAlbumId(song) {
  const album = getAlbum(song);
  const internal = song && song.internal ? song.internal : {};
  return firstPositiveNumber([
    album.id,
    internal.albumId,
    internal.album_id
  ]);
}

function resolveSongDate(song) {
  const knownDate = String(song.date || ((song.fields || {}).date) || "");
  if (knownDate) return knownDate;

  let albumId = getAlbumId(song);
  try {
    if (!albumId && song.id) {
      const detail = postForm("https://music.163.com/api/v3/song/detail", {
        c: JSON.stringify([{ id: Number(song.id) }]),
        ids: JSON.stringify([Number(song.id)])
      });
      const detailedSong = detail && Array.isArray(detail.songs) ? detail.songs[0] : null;
      albumId = getAlbumId(detailedSong || {});
    }

    if (!albumId) return "";
    const root = getJson("https://music.163.com/api/v1/album/" + encodeURIComponent(String(albumId)));
    return formatDate(getPublishTime((root && root.album) || {}));
  } catch (e) {
    Platform.log.warn(
      "NE",
      Platform.i18n.t("warn.resolveSongDate", String(e && e.message ? e.message : e))
    );
    return "";
  }
}

function getMvId(song) {
  return Number(song.mvid || song.mv || song.mvId || 0);
}

function getQualityBitrate(song) {
  const qualities = [
    song.sq,
    song.hMusic || song.h,
    song.mMusic || song.m,
    song.lMusic || song.l,
    song.losslessQuality,
    song.highQuality,
    song.mediumQuality,
    song.lowQuality
  ];

  for (let i = 0; i < qualities.length; i++) {
    const q = qualities[i];
    if (!q) continue;

    const bitrate = Number(q.bitrate || q.br || 0);
    if (bitrate > 0) return bitrate;
  }

  return 0;
}

function build163Key(song) {
  try {
    const album = getAlbum(song);
    const artists = getArtists(song);
    const bitrate = getQualityBitrate(song);

    const picDocId = Number(
      album.pic_str ||
      album.picStr ||
      album.picId ||
      album.pic ||
      0
    );

    const metadata = {
      musicName: String(song.name || ""),
      musicId: Number(song.id || 0),
      artist: artists.map(function (artist) {
        return [
          String(artist.name || ""),
          Number(artist.id || 0)
        ];
      }),
      album: String(album.name || ""),
      albumId: Number(album.id || 0),
      albumPic: String(album.picUrl || ""),
      albumPicDocId: picDocId,
      bitrate: bitrate,
      duration: getSongDuration(song),
      mvId: getMvId(song),
      alias: getAliases(song),
      transNames: [],
      format: bitrate > 320000 ? "flac" : "mp3",
      flag: 0,
      gain: 0.0
    };

    const json = JSON.stringify(metadata).replace(/\//g, "\\/");
    return (
      "163 key(Don't modify):" +
      Platform.crypto.aesEcbPkcs5EncryptBase64("music:" + json, AES_163_KEY)
    );
  } catch (e) {
    Platform.log.warn("NE", Platform.i18n.t("warn.buildCommentKey", String(e && e.message ? e.message : e)));
    return "";
  }
}
function getCommentContentMode(request) {
  const config = request && request.config ? request.config : {};
  return String(config.comment_content || "alias");
}

function buildCommentField(song, request) {
  const mode = getCommentContentMode(request);
  const aliases = getAliases(song);

  if (mode === "none") {
    return "";
  }

  if (mode === "alias") {
    return aliases.length ? aliases.join(" / ") : "";
  }

  if (mode === "netease_163_key") {
    return build163Key(song);
  }

  return "";
}
function mapSong(song, request) {
  const artists = getArtists(song);
  const album = getAlbum(song);

  const picUrl = String(album.picUrl || "").replace("http:", "https:");
  const artistText = artists
    .map(function (artist) {
      return artist.name || "";
    })
    .filter(Boolean)
    .join(request.separator || "/");

  const fields = {
    title: String(song.name || ""),
    artist: artistText,
    album: String(album.name || ""),
    date: formatDate(getPublishTime(song)),
    track_number: getTrackNumber(song),
    disc_number: getDiscNumber(song),
    cover_url: picUrl
  };

  const comment = buildCommentField(song, request);
  if (comment) {
    fields.comment = comment;
  }

  return {
    id: String(song.id || ""),
    title: fields.title,
    artist: fields.artist,
    album: fields.album,
    duration: getSongDuration(song),
    date: fields.date,
    trackNumber: fields.track_number,
    discNumber: fields.disc_number,
    picUrl: picUrl,
    fields: fields,
    internal: {
      albumId: String(album.id || "")
    }
  };
}

function mapEapiSongResource(resource, request) {
  const song =
    resource &&
    resource.baseInfo &&
    resource.baseInfo.simpleSongData
      ? resource.baseInfo.simpleSongData
      : null;

  if (!song) return null;
  return mapSong(song, request);
}

function searchSongsByEapi(request) {
  const pageSize = Number(request.pageSize || 20);
  const page = Math.max(1, Number(request.page || 1));
  const offset = Math.max(0, (page - 1) * pageSize);

  const root = eapiRequest("/eapi/search/song/list/page", {
    limit: String(pageSize),
    offset: String(offset),
    keyword: request.keyword || "",
    scene: "NORMAL",
    needCorrect: "true"
  });

  const resources =
    root &&
    root.data &&
    Array.isArray(root.data.resources)
      ? root.data.resources
      : [];

  return resources
    .map(function (resource) {
      return mapEapiSongResource(resource, request);
    })
    .filter(function (song) {
      return song && song.id && song.title;
    });
}

function searchSongsByCloudSearchFallback(request) {
  const pageSize = Number(request.pageSize || 20);
  const page = Math.max(1, Number(request.page || 1));
  const offset = Math.max(0, (page - 1) * pageSize);

  const root = postForm("https://music.163.com/api/cloudsearch/pc", {
    s: request.keyword || "",
    type: 1,
    offset: offset,
    limit: pageSize
  });

  const songs =
    root &&
    root.result &&
    Array.isArray(root.result.songs)
      ? root.result.songs
      : [];

  return songs
    .map(function (song) {
      return mapSong(song, request);
    })
    .filter(function (song) {
      return song && song.id && song.title;
    });
}

function searchSongs(request) {
  try {
    return searchSongsByEapi(request);
  } catch (e) {
    Platform.log.warn(
      "NE",
      Platform.i18n.t(
        "warn.eapiSearchFallback",
        String(e && e.message ? e.message : e)
      )
    );

    return searchSongsByCloudSearchFallback(request);
  }
}

// ---------------------------------------------------------------------------
// 歌词
// ---------------------------------------------------------------------------
//
// 参考原版 Lyrico 插件包的接口（/eapi/song/lyric/v1，lv/tv/rv/yv = -1）：
//   yrc     逐字歌词
//   lrc     逐行歌词
//   tlyric  翻译
// 这里把三种都摊平成宿主认的"一条候选"格式：
//   { title, artist, album, type: "word"|"line", lyrics, translation }

function looksLikeLyrics(text) {
  const s = String(text || "");
  if (s.length < 4) return false;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) return false;
  return /\d{1,3}:\d{1,2}/.test(s);
}

function isWordByWord(text) {
  return /<\d{1,3}:\d{1,2}/.test(String(text || ""));
}

/** 逐字歌词去掉逐字标记后就是标准 LRC。 */
function wordByWordToLrc(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map(function (line) {
      const m = line.match(/^\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/);
      if (!m) return "";
      const body = line
        .replace(/^\[[^\]]*\]/, "")
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "")
        .trim();
      return body ? "[" + m[1] + "]" + body : "";
    })
    .filter(Boolean)
    .join("\n");
}

function neLyricCandidates(request) {
  const song = request.song || {};
  if (song.id && song.id !== "local-song") return [song];
  return searchSongs({
    keyword: String(request.keyword || [song.title, song.artist].filter(Boolean).join(" ")),
    page: 1,
    pageSize: 5,
    separator: "/",
    config: request.config || {}
  });
}

function getLyrics(request) {
  try {
    const out = [];
    const songs = neLyricCandidates(request) || [];
    for (let i = 0; i < songs.length; i++) {
      const song = songs[i];
      if (!song || !song.id) continue;
      let root;
      try {
        root = eapiRequest("/eapi/song/lyric/v1", {
          id: Number(song.id),
          lv: "-1",
          tv: "-1",
          rv: "-1",
          yv: "-1"
        });
      } catch (e) {
        continue;
      }
      const yrc = root && root.yrc && root.yrc.lyric ? String(root.yrc.lyric) : "";
      const lrc = root && root.lrc && root.lrc.lyric ? String(root.lrc.lyric) : "";
      const tlyric = root && root.tlyric && root.tlyric.lyric ? String(root.tlyric.lyric) : "";
      if (!yrc && !lrc) continue;

      const title = String(song.title || "");
      const artist = String(song.artist || "");
      const album = String(song.album || "");

      if (yrc && isWordByWord(yrc)) {
        out.push({
          id: String(song.id), title: title, artist: artist, album: album,
          type: "word", lyrics: yrc, translation: tlyric
        });
        const plain = wordByWordToLrc(yrc);
        if (looksLikeLyrics(plain)) {
          out.push({
            id: String(song.id), title: title, artist: artist, album: album,
            type: "line", lyrics: plain, translation: tlyric
          });
        }
        return out;
      }
      if (looksLikeLyrics(lrc) || looksLikeLyrics(yrc)) {
        out.push({
          id: String(song.id), title: title, artist: artist, album: album,
          type: "line", lyrics: looksLikeLyrics(lrc) ? lrc : yrc, translation: tlyric
        });
        return out;
      }
    }
    return out;
  } catch (e) {
    Platform.log.error("网易云音乐", "歌词获取失败：" + String(e && e.message ? e.message : e));
    return [];
  }
}
