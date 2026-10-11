// QQ 音乐 · 艺术家图片插件
//
// 从上游 Lyrico 的 QQ 插件里把「艺术家图」这一段单独拆出来：
// 只保留 searchArtistImages 这条链路，搜歌 / 歌词 / 封面相关代码一律不带。
//
// 流程：
//   1. soso 搜索接口按艺术家名搜歌，从结果的 singer 字段里拿歌手 mid；
//   2. mid 拼成歌手图地址 https://y.gtimg.cn/music/photo_new/T001R{size}x{size}M000{mid}.jpg
//
// 少了 Referer 腾讯会返回空内容 —— 这一点和上游一致，别删。

const QQ_SOSO_SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";

// 实测（node scripts/plugin-test.mjs + 直接请求图片地址）：
//   300 / 500 / 800 / 1200 能拿到真图，600 / 1000 返回 404。
// 数组沿用上游的 500 / 800 / 300 三档、顺序也不动：
// 宿主 urlsOf() 是「按数组顺序挑第一张能下载的」，改顺序会改变最终写入的那张图。
const QQ_ARTIST_IMAGE_SIZES = ['500', '800', '300'];

/** 从 request 里取艺术家名：优先 request.artist，其次 request.song.artist。 */
function qqArtistName(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

/** 名字是否算同一位艺术家：忽略大小写和空格，允许互相包含（"周杰伦" vs "周杰伦 Jay Chou"）。 */
function qqArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/** 歌手 mid → 各尺寸的歌手图地址（大图在前）。 */
function qqArtistImageUrls(mid) {
  return QQ_ARTIST_IMAGE_SIZES.map(function (size) {
    return 'https://y.gtimg.cn/music/photo_new/T001R' + size + 'x' + size + 'M000' + mid + '.jpg';
  });
}

/**
 * 搜艺术家图片。
 *
 * @param {Object} request 宿主下发的请求：{ artist, song: { artist }, pageSize, config }
 * @returns {Array} [{ id, name, imageUrl, imageUrls, internal: { qq_singer_mid } }]
 */
function searchArtistImages(request) {
  try {
    const artist = qqArtistName(request);
    if (!artist) return [];
    const url = QQ_SOSO_SEARCH_URL +
      '?w=' + encodeURIComponent(artist) +
      '&format=json&p=1&n=10&t=0&aggr=1&cr=1&lossless=0&new_json=1';
    const text = Platform.http.getText(url, {
      headers: {
        // 少了这个 Referer 腾讯会返回空内容。
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const root = JSON.parse(String(text || '{}'));
    const list = (((root.data || {}).song || {}).list) || [];
    const seen = {};
    const out = [];
    list.forEach(function (item) {
      const singers = Array.isArray(item.singer) ? item.singer : [];
      singers.forEach(function (singer) {
        const mid = String(singer.mid || '').trim();
        if (!mid || seen[mid]) return;
        seen[mid] = true;
        const urls = qqArtistImageUrls(mid);
        out.push({
          id: String(singer.id || mid),
          name: String(singer.name || ''),
          imageUrl: urls[0],
          imageUrls: urls,
          internal: { qq_singer_mid: mid }
        });
      });
    });
    // 名字完全对得上的排前面：搜索第一名未必是本人（翻唱、同名）。
    out.sort(function (a, b) {
      return (qqArtistMatches(a.name, artist) ? 0 : 1) - (qqArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    Platform.log.error('QQ音乐', Platform.i18n.t('error.artistImages', String(e && e.message ? e.message : e)));
    return [];
  }
}
