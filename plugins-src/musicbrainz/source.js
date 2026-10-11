// MusicBrainz API 通信层
// 规则：必须携带可识别 User-Agent；限流约 1 请求/秒（超限返回 503）
// 查询类请求（recording/work 详情）按 MBID 缓存 7 天，MBID 稳定可安全复用
var MusicBrainz = MusicBrainz || {};

MusicBrainz.BASE_URL = "https://musicbrainz.org/ws/2";
MusicBrainz.CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
MusicBrainz.USER_AGENT = "Lyrico-MusicBrainz-Plugin/1.0.0 (com.musicbrainz.source; musicbrainz.org)";

MusicBrainz.getConfig = function (request) {
  var config = request.config || {};
  return {
    timeout: parseInt(config.timeout || "20", 10) * 1000,
    enrich: config.enrich === "true",
    enrichLimit: Math.max(1, parseInt(config.enrich_limit || "5", 10))
  };
};

/**
 * GET 请求。cacheKey 非空时走缓存（详情查询）；失败（网络错误 / 503 限流 / 解析失败）返回 null
 */
MusicBrainz.get = function (path, params, config, cacheKey) {
  var url = MusicBrainz.BASE_URL + path;
  var queryParts = ["fmt=json"];
  var keys = Object.keys(params || {});
  for (var i = 0; i < keys.length; i++) {
    queryParts.push(
      encodeURIComponent(keys[i]) + "=" + encodeURIComponent(params[keys[i]])
    );
  }
  url += "?" + queryParts.join("&");

  if (cacheKey) {
    var cached = Platform.cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* 缓存损坏，走网络 */ }
    }
  }

  try {
    var text = Platform.http.getText(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": MusicBrainz.USER_AGENT
      },
      readTimeoutMs: config.timeout
    });
    var data = JSON.parse(text);
    if (cacheKey) {
      Platform.cache.set(cacheKey, text, MusicBrainz.CACHE_TTL_MS);
    }
    return data;
  } catch (e) {
    // 503 限流 / 网络失败：调用方按可跳过处理
    Platform.log.warn("MusicBrainz", "request failed: " + (e && e.message ? e.message : e));
    return null;
  }
};

// MusicBrainz 数据映射：artist-credit 拼接、work 关系 → 词曲作者
var MusicBrainz = MusicBrainz || {};

/**
 * artist-credit 数组 → 字符串。
 * 优先使用 MB 自带的 joinphrase（如 " feat. "、" & "），缺失时回退分隔符
 */
MusicBrainz.joinArtistCredit = function (credit, separator) {
  if (!Array.isArray(credit)) return "";
  var result = "";
  for (var i = 0; i < credit.length; i++) {
    var part = credit[i];
    if (!part || !part.name) continue;
    result += part.name;
    if (part.joinphrase) {
      result += part.joinphrase;
    } else if (i < credit.length - 1) {
      result += (separator || "/");
    }
  }
  return result;
};

/** 取录音详情中第一个关联的 work MBID（recording lookup 需 inc=work-rels） */
MusicBrainz.extractWorkMbid = function (recordingDetail) {
  var relations = (recordingDetail && recordingDetail.relations) || [];
  for (var i = 0; i < relations.length; i++) {
    var rel = relations[i];
    if (rel["target-type"] === "work" && rel.work && rel.work.id) {
      return rel.work.id;
    }
  }
  return null;
};

/**
 * work 详情（inc=artist-rels）→ 词曲作者。
 * MB 关系类型：composer（作曲）/ lyricist（作词）/ writer（词曲兼写，映射到两者）
 */
MusicBrainz.extractCreditsFromWork = function (workDetail) {
  var composers = [];
  var lyricists = [];
  var relations = (workDetail && workDetail.relations) || [];
  for (var i = 0; i < relations.length; i++) {
    var rel = relations[i];
    var name = rel.artist && rel.artist.name;
    if (!name) continue;
    if (rel.type === "composer") {
      composers.push(name);
    } else if (rel.type === "lyricist") {
      lyricists.push(name);
    } else if (rel.type === "writer") {
      composers.push(name);
      lyricists.push(name);
    }
  }
  return { composers: composers, lyricists: lyricists };
};

/** 录音详情的 genres（inc=genres）→ 名称数组，按计数降序 */
MusicBrainz.extractGenres = function (recordingDetail) {
  var genres = (recordingDetail && recordingDetail.genres) || [];
  var mapped = [];
  for (var i = 0; i < genres.length; i++) {
    if (genres[i] && genres[i].name) mapped.push({ name: genres[i].name, count: genres[i].count || 0 });
  }
  mapped.sort(function (a, b) { return b.count - a.count; });
  return mapped.map(function (g) { return g.name; });
};

/**
 * Artist image search for the MusicBrainz plugin.
 *
 * MusicBrainz itself has no images, but every artist has an MBID and the Cover Art
 * Archive serves artist images at a predictable URL:
 *
 *   https://coverartarchive.org/artist/{mbid}/front-500
 */

function mbArtistName(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

function mbArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/** MusicBrainz 的查询语法：把引号转义掉，避免用户输入破坏查询。 */
function mbEscape(value) {
  return String(value || '').replace(/[\\"]/g, '\\$&');
}

function coverArtArchiveUrls(mbid) {
  const id = String(mbid || '').trim();
  if (!id) return [];
  return MB_ARTIST_IMAGE_SIZES.map(function (size) {
    return 'https://coverartarchive.org/artist/' + encodeURIComponent(id) + '/' + size;
  });
}

// MusicBrainz × Lyrico 插件入口
// 数据源：https://musicbrainz.org（开放元数据库，无歌词数据，仅元数据与封面）
// 封面来自 Cover Art Archive：URL 按 release MBID 规律构造，零额外请求

/**
 * 构建结构化 Lucene 查询。
 * Lyrico 的搜索关键词通常为"歌名 艺术家"（title + artist 空格拼接），直接模糊查询会把
 * 艺术家名误当歌名匹配（如搜"17 Avril Lavigne"返回一堆歌名叫"Avril Lavigne"的翻唱）。
 * 这里对每个切分点组合 recording/artist 字段查询并加权，整体短语兜底：
 * 正确切分（如 recording:"17" AND artist:"Avril Lavigne"）得分最高排最前，
 * 错确切分查不到结果不影响，兜底子句保证模糊匹配能力不退化。
 */
function buildQuery(keyword) {
  var tokens = keyword.split(/\s+/);
  if (tokens.length < 2) return keyword;

  function esc(s) { return s.replace(/"/g, '\\"'); }

  var clauses = [];
  var maxSplit = Math.min(tokens.length - 1, 6); // 词过多时限制子句数，避免查询串过长
  for (var i = 1; i <= maxSplit; i++) {
    var title = esc(tokens.slice(0, i).join(" "));
    var artist = esc(tokens.slice(i).join(" "));
    clauses.push('(recording:"' + title + '" AND artist:"' + artist + '")^4');
  }
  clauses.push('"' + esc(keyword) + '"'); // 整体模糊兜底
  return clauses.join(" OR ");
}

/** Lyrico 后续版本将直接下发结构化 title/artist 字段，有则构建字段化查询（无需切分穷举） */
function buildStructuredQuery(title, artist) {
  function esc(s) { return s.replace(/"/g, '\\"'); }
  if (title && artist) return '(recording:"' + esc(title) + '" AND artist:"' + esc(artist) + '")^4';
  if (title) return 'recording:"' + esc(title) + '"';
  return 'artist:"' + esc(artist) + '"';
}

/** 调 /ws/2/recording 搜索（query 由调用方构建），返回原始 recordings */
function searchApiRecordings(query, page, pageSize, config) {
  var offset = (Math.max(1, page) - 1) * pageSize;
  var data = MusicBrainz.get("/recording/", { query: query, limit: pageSize, offset: offset }, config, null);
  return (data && data.recordings) || [];
}

/** MB 录音 → Lyrico song 对象（仅用搜索结果，无额外请求） */
function mapRecording(rec, request) {
  var separator = request.separator || "/";
  var release = (rec.releases && rec.releases[0]) || {};
  var medium = (release.media && release.media[0]) || {};
  var track = (medium.track && medium.track[0]) || {};

  var artist = MusicBrainz.joinArtistCredit(rec["artist-credit"], separator);
  var albumArtist = MusicBrainz.joinArtistCredit(release["artist-credit"], separator);
  var date = release.date || rec["first-release-date"] || "";

  var fields = {
    title: rec.title || "",
    artist: artist,
    album: release.title || "",
    date: date
  };
  if (albumArtist) fields.album_artist = albumArtist;
  if (track.number) fields.track_number = String(track.number);
  if (medium.position) fields.disc_number = String(medium.position);

  // 封面：Cover Art Archive 按 release MBID 构造（无封面时 Lyrico 侧加载失败，可接受）
  var coverUrl = release.id ? ("https://coverartarchive.org/release/" + release.id + "/front") : "";

  return {
    id: rec.id || "",
    title: rec.title || "",
    artist: artist,
    album: release.title || "",
    date: date,
    duration: rec.length || 0,
    picUrl: coverUrl,
    fields: fields,
    internal: {
      mb_recording: rec.id || "",
      mb_release: release.id || ""
    }
  };
}

/**
 * 补全词曲作者与流派：recording 详情（work-rels + genres）→ work 详情（artist-rels）
 * 两跳共 2 请求/首，全部命中缓存则 0 请求；任一跳失败视为限流，中断本次补全
 */
function enrichSong(song, config, separator) {
  var mbid = song.internal && song.internal.mb_recording;
  if (!mbid) return true;

  var detail = MusicBrainz.get("/recording/" + mbid, { inc: "work-rels+genres" }, config, "mb.rec." + mbid);
  if (!detail) return false;

  var genres = MusicBrainz.extractGenres(detail);
  if (genres.length > 0) song.fields.genre = genres.join(separator);

  var workMbid = MusicBrainz.extractWorkMbid(detail);
  if (workMbid) {
    var work = MusicBrainz.get("/work/" + workMbid, { inc: "artist-rels" }, config, "mb.work." + workMbid);
    if (!work) return false;
    var credits = MusicBrainz.extractCreditsFromWork(work);
    if (credits.composers.length > 0) song.fields.composer = credits.composers.join(separator);
    if (credits.lyricists.length > 0) song.fields.lyricist = credits.lyricists.join(separator);
  }
  return true;
}

function searchSongs(request) {
  try {
    var config = MusicBrainz.getConfig(request);
    var keyword = String(request.keyword || "").trim();
    var reqTitle = String(request.title || "").trim();
    var reqArtist = String(request.artist || "").trim();
    if (!keyword && !reqTitle && !reqArtist) return [];

    var page = Math.max(1, Number(request.page || 1));
    var pageSize = Number(request.pageSize || 20);

    var query = (reqTitle || reqArtist)
      ? buildStructuredQuery(reqTitle, reqArtist)
      : buildQuery(keyword);
    var recordings = searchApiRecordings(query, page, pageSize, config);

    var separator = request.separator || "/";
    var songs = recordings
      .map(function (rec) { return mapRecording(rec, request); })
      .filter(function (song) { return song.id && song.title; });

    // 完整元数据：受 MB 限流约束，仅补全前 N 首；失败（限流）即中断，靠缓存逐步补全
    if (config.enrich) {
      var limit = Math.min(config.enrichLimit, songs.length);
      for (var i = 0; i < limit; i++) {
        if (!enrichSong(songs[i], config, separator)) break;
      }
    }

    return songs;
  } catch (e) {
    Platform.log.error("MusicBrainz", Platform.i18n.t("error.searchSongsFailed", String(e && e.message ? e.message : e)));
    return [];
  }
}

function searchArtistImages(request) {
  try {
    const artist = mbArtistName(request);
    if (!artist) return [];

    var limit = Number(request.pageSize || 5);
    if (!isFinite(limit) || limit <= 0) limit = 5;
    if (limit > 10) limit = 10;

    const url =
      'https://musicbrainz.org/ws/2/artist?query=' +
      encodeURIComponent('artist:"' + mbEscape(artist) + '"') +
      '&limit=' + encodeURIComponent(limit) +
      '&fmt=json';

    const root = JSON.parse(
      Platform.http.getText(url, { headers: { Accept: 'application/json' } })
    );
    const artists = Array.isArray(root.artists) ? root.artists : [];

    const out = [];
    artists.forEach(function (item) {
      const mbid = String(item.id || '').trim();
      if (!mbid) return;
      const urls = coverArtArchiveUrls(mbid);
      if (!urls.length) return;
      out.push({
        id: mbid,
        name: String(item.name || ''),
        imageUrl: urls[0],
        imageUrls: urls,
        internal: { musicbrainz_artist_id: mbid }
      });
    });

    out.sort(function (a, b) {
      return (mbArtistMatches(a.name, artist) ? 0 : 1) - (mbArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    Platform.log.error(
      'MusicBrainz',
      Platform.i18n.t('error.artistImages', String(e && e.message ? e.message : e))
    );
    return [];
  }
}
