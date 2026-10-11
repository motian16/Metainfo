const SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
const DEVICE_MID = Platform.crypto.md5(String(Date.now()));

function buildQuery(params) {
  return Object.keys(params)
    .sort()
    .map(key => encodeURIComponent(key) + "=" + encodeURIComponent(String(params[key])))
    .join("&");
}

function signParams(customParams, body, module) {
  const now = Math.floor(Date.now() / 1000);
  const params = {};
  if (module === "Lyric") {
    params.appid = "3116";
    params.clientver = "11070";
  } else {
    params.userid = "0";
    params.appid = "3116";
    params.token = "";
    params.clienttime = String(now);
    params.iscorrection = "1";
    params.uuid = "-";
    params.mid = DEVICE_MID;
    params.dfid = "-";
    params.clientver = "11070";
    params.platform = "AndroidFilter";
  }

  Object.keys(customParams || {}).forEach(key => params[key] = customParams[key]);
  const sorted = Object.keys(params).sort().map(key => key + "=" + params[key]).join("");
  params.signature = Platform.crypto.md5(SALT + sorted + (body || "") + SALT);
  return params;
}

function getJson(url, headers) {
  const text = Platform.http.getText(url, {
    headers: Object.assign({
      "User-Agent": "Android14-1070-11070-201-0-SearchSong-wifi"
    }, headers || {})
  });
  return JSON.parse(text);
}

function normalizeImage(url) {
  return String(url || "").replace("{size}", "480").replace("http:", "https:");
}

function decryptKrc(base64Content) {
  const bodyBase64 = Platform.base64.dropBytes(base64Content || "", 4);
  const decodedBase64 = Platform.bytes.xorBase64(bodyBase64, KRC_KEY);
  return Platform.compression.inflateBase64ToText(decodedBase64);
}

function parseLanguageTag(tag) {
  if (!tag) return [];

  try {
    const root = JSON.parse(Platform.base64.decodeText(tag));
    return Array.isArray(root.content) ? root.content : [];
  } catch (e) {
    return [];
  }
}

function lineHasText(line) {
  const words = Array.isArray(line && line[2]) ? line[2] : [];
  return words.some(word => String((word && word[2]) || "").trim().length > 0);
}

function parseKrc(krcText) {
  const tags = {};
  const original = [];
  let languageItems = [];

  String(krcText || "").split(/\r?\n/).forEach(rawLine => {
    const line = String(rawLine || "").trim();
    if (!line || line.charAt(0) !== "[") return;

    const tag = line.match(/^\[(\w+):([^\]]*)]$/);
    if (tag) {
      tags[tag[1]] = tag[2] || "";
      if (tag[1] === "language") {
        languageItems = parseLanguageTag(tag[2]);
      }
      return;
    }

    const lineMatch = line.match(/^\[(\d+),(\d+)](.*)$/);
    if (!lineMatch) return;

    const lineStart = Number(lineMatch[1] || 0);
    const lineDuration = Number(lineMatch[2] || 0);
    const lineEnd = lineStart + lineDuration;
    const lineContent = lineMatch[3] || "";

    const wordOffsets = [];
    const wordRe = /<(\d+),(\d+),(\d+)>([^<]*)/g;
    let wordMatch;

    while ((wordMatch = wordRe.exec(lineContent)) !== null) {
      const offset = Number(wordMatch[1] || 0);
      const duration = Number(wordMatch[2] || 0);
      const text = wordMatch[4] || "";

      // 对齐 master：这里不丢空 text。
      // 空 text 对 language 罗马音的行号对齐有意义。
      wordOffsets.push([offset, duration, text]);
    }

    const words = [];

    wordOffsets.forEach((item, index) => {
      const offset = item[0];
      const duration = Number(item[1] || 0);
      const text = item[2];

      const wordStart = lineStart + offset;
      const wordEnd = duration > 0
        ? wordStart + duration
        : (index < wordOffsets.length - 1
          ? lineStart + Number(wordOffsets[index + 1][0] || offset)
          : lineEnd);

      words.push([wordStart, wordEnd, text]);
    });

    // 对齐 master：没有 KRC word 标签时，整行作为普通文本。
    if (!words.length && lineContent) {
      words.push([lineStart, lineEnd, lineContent]);
    }

    original.push([lineStart, lineEnd, words]);
  });

  let translated = null;
  let romanization = null;

  languageItems.forEach(item => {
    const content = Array.isArray(item.lyricContent) ? item.lyricContent : [];
    const type = Number(item.type);

    // Type 0: 罗马音/假名，逐行对应
    if (type === 0) {
      const romaList = [];
      let skippedEmpty = 0;

      original.forEach((line, index) => {
        if (!lineHasText(line)) {
          skippedEmpty += 1;
          return;
        }

        const contentIndex = index - skippedEmpty;

        if (contentIndex >= 0 && contentIndex < content.length) {
          const entry = content[contentIndex];
          const text = Array.isArray(entry)
            ? entry.map(x => String(x || "").trim()).filter(Boolean).join(" ")
            : "";

          if (text) {
            // translated / romanization 必须是行级文本格式：
            // [lineStartMs, lineEndMs, "text"]
            romaList.push([
              line[0],
              line[1],
              text
            ]);
          }
        }
      });

      romanization = romaList.length ? romaList : null;
      return;
    }

    // Type 1: 翻译，逐行对应。
    if (type === 1) {
      const transList = [];

      original.forEach((line, index) => {
        if (index < content.length) {
          const lineContentList = content[index];
          const text = Array.isArray(lineContentList) && lineContentList.length
            ? String(lineContentList[0] || "")
            : "";

          if (text) {
            // translated / romanization 必须是行级文本格式：
            // [lineStartMs, lineEndMs, "text"]
            transList.push([
              line[0],
              line[1],
              text
            ]);
          }
        }
      });

      translated = transList.length ? transList : null;
    }
  });

  return {
    type: "structured",
    tags: tags,
    original: original,
    translated: translated,
    romanization: romanization
  };
}

/**
 * Artist image search for the KuGou plugin.
 *
 * Written against KuGou's public mobile endpoints, using the same signing helpers the
 * rest of this plugin already relies on (`signParams` + `buildQuery` + `getJson`).
 *
 * Flow:
 *   1. `/api/v2/search/artist` with the artist name -> singer ids
 *   2. `/api/v2/search/singer/image` for the image path of one singer
 *   3. the image path carries a `{size}` placeholder, replaced with a real size
 */

function artistNameOf(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

function artistNameMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/** KuGou 的图片地址带 {size} 占位符，替换即可取不同尺寸。 */
function artistImageUrl(raw, size) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace('{size}', String(size)).replace('http:', 'https:');
}

function artistImageUrls(raw) {
  const out = [];
  KUGOU_ARTIST_IMAGE_SIZES.forEach(function (size) {
    const url = artistImageUrl(raw, size);
    if (url && out.indexOf(url) < 0) out.push(url);
  });
  return out;
}

/** 搜歌手，返回 [{ id, name, raw }]。 */
function searchKugouArtists(artist) {
  const params = signParams({
    keyword: artist,
    page: '1',
    pagesize: '5'
  }, '', 'Search');
  const url = 'https://complexsearch.kugou.com/v2/search/artist?' + buildQuery(params);
  const response = getJson(url, { 'x-router': 'complexsearch.kugou.com' });
  const data = response.data || {};
  const list = Array.isArray(data.lists) ? data.lists : [];
  const out = [];
  list.forEach(function (item) {
    const id = String(item.ArtistId || item.artistid || item.id || '').trim();
    const name = String(item.ArtistName || item.artistname || item.name || '').trim();
    const raw = String(item.Image || item.imgurl || item.singer_img || '').trim();
    if (!id && !raw) return;
    out.push({ id: id, name: name, raw: raw });
  });
  return out;
}

/** 用歌手 id 取图片地址。 */
function kugouArtistImageById(id) {
  try {
    const params = signParams({ singerid: String(id) }, '', 'Search');
    const url = 'https://mobilecdn.kugou.com/api/v2/search/singer/image?' + buildQuery(params);
    const response = getJson(url, {});
    const data = response.data || {};
    const info = Array.isArray(data.info) ? data.info[0] : null;
    if (!info) return '';
    return String(info.imgurl || info.Image || info.singer_img || '').trim();
  } catch (e) {
    return '';
  }
}

function mapSong(item, separator) {
  const singers = Array.isArray(item.Singers) ? item.Singers : [];
  const artist = singers.map(s => s.name || s.Name || "").filter(Boolean).join(separator || "/");
  const title = String(item.SongName || "");
  const album = String(item.AlbumName || "");
  const date = String(item.PublishDate || "");
  const coverUrl = normalizeImage(item.Image);
  const hash = String(item.FileHash || "");
  return {
    id: String(item.ID || ""),
    title: title,
    artist: artist,
    album: album,
    duration: Number(item.Duration || 0) * 1000,
    date: date,
    picUrl: coverUrl,
    fields: {
      title: title,
      artist: artist,
      album: album,
      date: date,
      cover_url: coverUrl,
      comment: String(item.Auxiliary || "")
    },
    internal: {
      hash: hash
    }
  };
}

function searchSongs(request) {
  const params = signParams({
    keyword: request.keyword || "",
    page: String(request.page || 1),
    pagesize: String(request.pageSize || 20)
  }, "", "Search");
  const url = "https://complexsearch.kugou.com/v2/search/song?" + buildQuery(params);
  const response = getJson(url, { "x-router": "complexsearch.kugou.com" });
  if (Number(response.error_code || 0) !== 0) return [];
  const list = response.data && Array.isArray(response.data.lists) ? response.data.lists : [];
  return list.map(item => mapSong(item, request.separator || "/"));
}

function searchArtistImages(request) {
  try {
    const artist = artistNameOf(request);
    if (!artist) return [];

    const out = [];
    const seen = {};

    searchKugouArtists(artist).forEach(function (entry) {
      let raw = entry.raw;
      if (!raw && entry.id) raw = kugouArtistImageById(entry.id);
      const urls = artistImageUrls(raw);
      if (!urls.length) return;
      const key = entry.id || urls[0];
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        id: String(entry.id || key),
        name: String(entry.name || artist),
        imageUrl: urls[0],
        imageUrls: urls,
        internal: { kugou_artist_id: String(entry.id || '') }
      });
    });

    out.sort(function (a, b) {
      return (artistNameMatches(a.name, artist) ? 0 : 1) - (artistNameMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    Platform.log.error(
      'KuGou',
      Platform.i18n.t('error.artistImages', String(e && e.message ? e.message : e))
    );
    return [];
  }
}
