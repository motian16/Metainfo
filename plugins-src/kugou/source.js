// 酷狗音乐 · 艺术家图片插件
//
// 从上游 Lyrico 的酷狗插件里把「艺术家图」这一段单独拆出来，只保留 searchArtistImages。
// 搜歌（complexsearch 签名接口）、歌词（KRC 解密 / 解析）全部不带。
//
// ⚠ 上游那两条链路在本机实测都已经不能用了，这里换成了酷狗移动端仍在服务的接口：
//   1. complexsearch.kugou.com/v2/search/artist → 404（同一个签名算法下的
//      /v2/search/song 是 200，说明签名没坏，是歌手搜索这个路径没了）；
//   2. mobilecdn.kugou.com → 连不上（TLS 证书域名不匹配）；
//   3. 改用 mobileservice.kugou.com（和 msearch.kugou.com 同一组移动端接口）：
//        /api/v3/search/singer?format=json&keyword=<名>&page=1&pagesize=5&showtype=1
//          → data[] { singername, singerid }
//        /api/v3/singer/info?format=json&singerid=<id>
//          → data.imgurl，形如
//            http://singerimg.kugou.com/uploadpic/softhead/{size}/{日期}/{哈希}.jpg
//      把 {size} 换成像素档位即可，顺手把 http 换成 https。

const KUGOU_SEARCH_SINGER_URL = 'https://mobileservice.kugou.com/api/v3/search/singer';
const KUGOU_SINGER_INFO_URL = 'https://mobileservice.kugou.com/api/v3/singer/info';
const KUGOU_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 歌手图最大取多少条：搜歌手 → 逐个查图，每条都要一次请求，别被一次搜索拖垮。
const KUGOU_ARTIST_LIMIT = 5;

// {size} 档位实测（node 直接请求图片地址，看状态码 + 文件头 + 字节数）：
//   100 / 150 / 200 / 240 / 300 / 400 / 480 / 500 / 600 / 800 / 1000 / 1200 全部 200 + JPEG，
//   且字节数随档位单调变大（100 → 4.5KB，240 → 15.8KB，480 → 57.6KB，1000 → 239KB，1200 → 345KB），
//   说明服务端确实在按档位缩放，不是占位图。
// 数组按「大 → 小」排：宿主 urlsOf() 按数组顺序挑第一张能下载的，主图给 1000 足够清晰又不至于太大。
const KUGOU_ARTIST_IMAGE_SIZES = ['1000', '480', '240'];

/** 这个插件的 HTTP 入口：带上浏览器 UA，酷狗移动端接口不校验签名。 */
function getJson(url) {
  const text = Platform.http.getText(url, {
    headers: {
      'User-Agent': KUGOU_UA,
      'Referer': 'https://www.kugou.com/'
    }
  });
  return JSON.parse(text);
}

/** 从 request 里取艺术家名：优先 request.artist，其次 request.song.artist。 */
function artistNameOf(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

/** 名字是否算同一位艺术家：忽略大小写和空格，允许互相包含。 */
function artistNameMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/** 酷狗的图片地址带 {size} 占位符，替换即可取不同尺寸。 */
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

/** 搜歌手，返回 [{ id, name, raw }]。raw 是接口直接给的图片模板（有就省一次请求）。 */
function searchKugouArtists(artist) {
  const url = KUGOU_SEARCH_SINGER_URL +
    '?format=json&keyword=' + encodeURIComponent(artist) +
    '&page=1&pagesize=' + encodeURIComponent(String(KUGOU_ARTIST_LIMIT)) + '&showtype=1';
  const response = getJson(url);
  // 移动端这组接口有的版本把数组放在 data，有的放在 data.info。
  const data = response.data || {};
  const list = Array.isArray(data) ? data : (Array.isArray(data.info) ? data.info : []);
  const out = [];
  list.forEach(function (item) {
    const id = String(item.singerid || item.ArtistId || item.id || '').trim();
    const name = String(item.singername || item.ArtistName || item.name || '').trim();
    const raw = String(item.imgurl || item.Image || item.img || '').trim();
    if (!id && !raw) return;
    out.push({ id: id, name: name, raw: raw });
  });
  return out;
}

/** 用歌手 id 取图片模板。失败不抛异常，返回空串让上层跳过这一条。 */
function kugouArtistImageById(id) {
  try {
    const url = KUGOU_SINGER_INFO_URL + '?format=json&singerid=' + encodeURIComponent(String(id));
    const response = getJson(url);
    const data = response.data || {};
    return String(data.imgurl || data.Image || data.img || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * 搜艺术家图片。
 *
 * @param {Object} request 宿主下发的请求：{ artist, song: { artist }, pageSize, config }
 * @returns {Array} [{ id, name, imageUrl, imageUrls, internal: { kugou_artist_id } }]
 */
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

    // 名字对得上的排前面：搜"周杰伦"会带回一堆"想见周杰伦"之类的翻唱号。
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
