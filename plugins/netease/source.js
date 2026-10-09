// 网易云音乐 · 艺术家图片插件
//
// 从上游 Lyrico 的网易云插件里把「艺术家图」这一段单独拆出来：
// 只保留 searchArtistImages 这条链路，搜歌（EAPI / cloudsearch）、歌词、封面一律不带。
//
// 接口：https://music.163.com/api/search/get?s=<关键词>&type=100
//   type=100 就是「搜歌手」，结果在 result.artists[]。
//   img1v1Url 是 1:1 头像（优先），缺失才退回 picUrl。

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/3.1.3.203419";

const NE_ARTIST_SEARCH_URL = 'https://music.163.com/api/search/get';

/** 这个插件的 HTTP 入口：固定带上网易云认的 UA 和 Referer。 */
function getJson(url) {
  const text = Platform.http.getText(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": "https://music.163.com/"
    }
  });

  return JSON.parse(text);
}

/** 从 request 里取艺术家名：优先 request.artist，其次 request.song.artist。 */
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

/** 名字是否算同一位艺术家：忽略大小写和空格，允许互相包含。 */
function neArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/**
 * 搜艺术家图片。
 *
 * @param {Object} request 宿主下发的请求：{ artist, song: { artist }, pageSize, config }
 * @returns {Array} [{ id, name, imageUrl, imageUrls, internal }]
 */
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
    // 名字对得上的排前面。
    out.sort(function (a, b) {
      return (neArtistMatches(a.name, artist) ? 0 : 1) - (neArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    Platform.log.error('网易云音乐', Platform.i18n.t('error.artistImages', String(e && e.message ? e.message : e)));
    return [];
  }
}
