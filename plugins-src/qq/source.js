const QQ_SOSO_SEARCH_URL = "https://c.y.qq.com/soso/fcgi-bin/client_search_cp";
const QQ_MUSICU_API_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";
const QQ_MUSICU_COMM = {
  ct: "11",
  cv: "1003006",
  v: "1003006",
  os_ver: "15",
  phonetype: "24122RKC7C",
  tmeAppID: "qqmusiclight",
  nettype: "NETWORK_WIFI"
};

function postMusicu(module, method, param) {
  const body = JSON.stringify({
    comm: QQ_MUSICU_COMM,
    req_0: {
      method: method,
      module: module,
      param: param
    }
  });
  const text = Platform.http.postText(QQ_MUSICU_API_URL, body, {
    contentType: "application/json; charset=utf-8",
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return JSON.parse(text);
}

function randomSearchId() {
  return String(Math.floor(10000000000000000 + Math.random() * 80000000000000000));
}

// 艺术家图片：QQ 音乐的歌手图。
// URL 形如 https://y.qq.com/music/photo_new/T001R{size}x{size}M000{singerMid}.jpg
// 实测 800x800 是平台能给出的最大尺寸，其次 500、300；600/900/1000 不存在。
const QQ_ARTIST_IMAGE_SIZES = ['500', '800', '300'];

function qqArtistName(request) {
  const song = request.song || {};
  return String(request.artist || song.artist || '').trim();
}

function qqArtistMatches(a, b) {
  const x = String(a || '').toLowerCase().replace(/\s+/g, '');
  const y = String(b || '').toLowerCase().replace(/\s+/g, '');
  if (!x || !y) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

function qqArtistImageUrls(mid) {
  return QQ_ARTIST_IMAGE_SIZES.map(function (size) {
    return 'https://y.gtimg.cn/music/photo_new/T001R' + size + 'x' + size + 'M000' + mid + '.jpg';
  });
}

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
    out.sort(function (a, b) {
      return (qqArtistMatches(a.name, artist) ? 0 : 1) - (qqArtistMatches(b.name, artist) ? 0 : 1);
    });
    return out;
  } catch (e) {
    Platform.log.error('QQ音乐', Platform.i18n.t('error.artistImages', String(e && e.message ? e.message : e)));
    return [];
  }
}

const QRC_KEY = "!@#)(*$%123ZXC!@!@#)(NHL";
const SBOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,15,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,10,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];

function buildCoverUrl(albumMid, config) {
  if (!albumMid) return "";
  const size = (config && config.cover_size) || "1200";
  return "https://y.gtimg.cn/music/photo_new/T002R" + size + "x" + size + "M000" + albumMid + ".jpg";
}

function formatFixed(value, digits, suffix) {
  const number = Number(value);
  if (!isFinite(number)) return "";
  return number.toFixed(digits) + (suffix || "");
}

function mapSong(item, request) {
  const singer = Array.isArray(item.singer) ? item.singer.map(x => x.name || "").filter(Boolean) : [];
  const album = item.album || {};
  const fields = {
    title: String(item.title || ""),
    artist: singer.join(request.separator || "/"),
    album: String(album.name || ""),
    date: String(item.time_public || ""),
    track_number: String(item.index_album || ""),
    cover_url: buildCoverUrl(album.mid, request.config || {})
  };

  const subtitle = item.subtitle || item.desc || "";
  if (subtitle) fields.comment = String(subtitle);

  // QQ uses a zero-based disc index; tags use one-based disc numbers.
  const discIndex = item.index_cd;
  if (typeof discIndex === "number" && Number.isSafeInteger(discIndex) &&
      discIndex >= 0 && discIndex < Number.MAX_SAFE_INTEGER) {
    fields.disc_number = String(discIndex + 1);
  }

  if (item.volume) {
    const cfg = request.config || {};
    const rgOff = cfg.replaygain === false || cfg.replaygain === "false";
    if (!rgOff) {
      const gain = formatFixed(item.volume.gain, 3, " dB");
      const peak = formatFixed(item.volume.peak, 6, "");
      const lra = formatFixed(item.volume.lra, 3, " LU");
      if (gain) fields.replaygain_track_gain = gain;
      if (peak) fields.replaygain_track_peak = peak;
      fields.replaygain_reference_loudness = "-18 LUFS";
    }
  }

  return {
    id: String(item.id || ""),
    title: fields.title,
    artist: fields.artist,
    album: fields.album,
    duration: Number(item.interval || 0) * 1000,
    date: fields.date,
    trackNumber: fields.track_number,
    picUrl: fields.cover_url,
    fields: fields
  };
}

function searchSongs(request) {
  const page = Number(request.page || 1);
  const pageSize = Number(request.pageSize || 20);

  const response = postMusicu("music.search.SearchCgiService", "DoSearchForQQMusicLite", {
    search_id: randomSearchId(),
    remoteplace: "search.android.keyboard",
    query: String(request.keyword || ""),
    search_type: 0,
    num_per_page: pageSize,
    page_num: page,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1
  });

  const songs = (((response.req_0 || {}).data || {}).body || {}).item_song || [];
  return songs.map(item => mapSong(item, request)).filter(song => song.id && song.title);
}

function bitnum(bytes, b, c) {
  const byteIndex = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8);
  if (byteIndex >= bytes.length) return 0;
  return (((bytes[byteIndex] >>> (7 - (b % 8))) & 1) << c) >>> 0;
}

function bitnumIntr(value, b, c) {
  return (((value >>> (31 - b)) & 1) << c) >>> 0;
}

function bitnumIntl(value, b, c) {
  return (((value << b) & 0x80000000) >>> c) >>> 0;
}

function sboxBit(value) {
  return (value & 32) | ((value & 31) >>> 1) | ((value & 1) << 4);
}

function initialPermutation(input) {
  const s0 =
    bitnum(input,57,31)|bitnum(input,49,30)|bitnum(input,41,29)|bitnum(input,33,28)|bitnum(input,25,27)|bitnum(input,17,26)|bitnum(input,9,25)|bitnum(input,1,24)|
    bitnum(input,59,23)|bitnum(input,51,22)|bitnum(input,43,21)|bitnum(input,35,20)|bitnum(input,27,19)|bitnum(input,19,18)|bitnum(input,11,17)|bitnum(input,3,16)|
    bitnum(input,61,15)|bitnum(input,53,14)|bitnum(input,45,13)|bitnum(input,37,12)|bitnum(input,29,11)|bitnum(input,21,10)|bitnum(input,13,9)|bitnum(input,5,8)|
    bitnum(input,63,7)|bitnum(input,55,6)|bitnum(input,47,5)|bitnum(input,39,4)|bitnum(input,31,3)|bitnum(input,23,2)|bitnum(input,15,1)|bitnum(input,7,0);
  const s1 =
    bitnum(input,56,31)|bitnum(input,48,30)|bitnum(input,40,29)|bitnum(input,32,28)|bitnum(input,24,27)|bitnum(input,16,26)|bitnum(input,8,25)|bitnum(input,0,24)|
    bitnum(input,58,23)|bitnum(input,50,22)|bitnum(input,42,21)|bitnum(input,34,20)|bitnum(input,26,19)|bitnum(input,18,18)|bitnum(input,10,17)|bitnum(input,2,16)|
    bitnum(input,60,15)|bitnum(input,52,14)|bitnum(input,44,13)|bitnum(input,36,12)|bitnum(input,28,11)|bitnum(input,20,10)|bitnum(input,12,9)|bitnum(input,4,8)|
    bitnum(input,62,7)|bitnum(input,54,6)|bitnum(input,46,5)|bitnum(input,38,4)|bitnum(input,30,3)|bitnum(input,22,2)|bitnum(input,14,1)|bitnum(input,6,0);
  return [s0 >>> 0, s1 >>> 0];
}

function inversePermutation(s0, s1) {
  return [
    bitnumIntr(s1,4,7)|bitnumIntr(s0,4,6)|bitnumIntr(s1,12,5)|bitnumIntr(s0,12,4)|bitnumIntr(s1,20,3)|bitnumIntr(s0,20,2)|bitnumIntr(s1,28,1)|bitnumIntr(s0,28,0),
    bitnumIntr(s1,5,7)|bitnumIntr(s0,5,6)|bitnumIntr(s1,13,5)|bitnumIntr(s0,13,4)|bitnumIntr(s1,21,3)|bitnumIntr(s0,21,2)|bitnumIntr(s1,29,1)|bitnumIntr(s0,29,0),
    bitnumIntr(s1,6,7)|bitnumIntr(s0,6,6)|bitnumIntr(s1,14,5)|bitnumIntr(s0,14,4)|bitnumIntr(s1,22,3)|bitnumIntr(s0,22,2)|bitnumIntr(s1,30,1)|bitnumIntr(s0,30,0),
    bitnumIntr(s1,7,7)|bitnumIntr(s0,7,6)|bitnumIntr(s1,15,5)|bitnumIntr(s0,15,4)|bitnumIntr(s1,23,3)|bitnumIntr(s0,23,2)|bitnumIntr(s1,31,1)|bitnumIntr(s0,31,0),
    bitnumIntr(s1,0,7)|bitnumIntr(s0,0,6)|bitnumIntr(s1,8,5)|bitnumIntr(s0,8,4)|bitnumIntr(s1,16,3)|bitnumIntr(s0,16,2)|bitnumIntr(s1,24,1)|bitnumIntr(s0,24,0),
    bitnumIntr(s1,1,7)|bitnumIntr(s0,1,6)|bitnumIntr(s1,9,5)|bitnumIntr(s0,9,4)|bitnumIntr(s1,17,3)|bitnumIntr(s0,17,2)|bitnumIntr(s1,25,1)|bitnumIntr(s0,25,0),
    bitnumIntr(s1,2,7)|bitnumIntr(s0,2,6)|bitnumIntr(s1,10,5)|bitnumIntr(s0,10,4)|bitnumIntr(s1,18,3)|bitnumIntr(s0,18,2)|bitnumIntr(s1,26,1)|bitnumIntr(s0,26,0),
    bitnumIntr(s1,3,7)|bitnumIntr(s0,3,6)|bitnumIntr(s1,11,5)|bitnumIntr(s0,11,4)|bitnumIntr(s1,19,3)|bitnumIntr(s0,19,2)|bitnumIntr(s1,27,1)|bitnumIntr(s0,27,0)
  ].map(x => x & 0xff);
}

function desF(state, key) {
  const t1 = (bitnumIntl(state,31,0)|((state & 0xf0000000) >>> 1)|bitnumIntl(state,4,5)|bitnumIntl(state,3,6)|((state & 0x0f000000) >>> 3)|bitnumIntl(state,8,11)|bitnumIntl(state,7,12)|((state & 0x00f00000) >>> 5)|bitnumIntl(state,12,17)|bitnumIntl(state,11,18)|((state & 0x000f0000) >>> 7)|bitnumIntl(state,16,23)) >>> 0;
  const t2 = (bitnumIntl(state,15,0)|((state & 0x0000f000) << 15)|bitnumIntl(state,20,5)|bitnumIntl(state,19,6)|((state & 0x00000f00) << 13)|bitnumIntl(state,24,11)|bitnumIntl(state,23,12)|((state & 0x000000f0) << 11)|bitnumIntl(state,28,17)|bitnumIntl(state,27,18)|((state & 0x0000000f) << 9)|bitnumIntl(state,0,23)) >>> 0;
  const l = [(t1>>>24)&255,(t1>>>16)&255,(t1>>>8)&255,(t2>>>24)&255,(t2>>>16)&255,(t2>>>8)&255].map((v,i)=>v ^ key[i]);
  const r = ((SBOX[0][sboxBit(l[0]>>>2)] << 28) | (SBOX[1][sboxBit(((l[0]&3)<<4)|(l[1]>>>4))] << 24) | (SBOX[2][sboxBit(((l[1]&15)<<2)|(l[2]>>>6))] << 20) | (SBOX[3][sboxBit(l[2]&63)] << 16) | (SBOX[4][sboxBit(l[3]>>>2)] << 12) | (SBOX[5][sboxBit(((l[3]&3)<<4)|(l[4]>>>4))] << 8) | (SBOX[6][sboxBit(((l[4]&15)<<2)|(l[5]>>>6))] << 4) | SBOX[7][sboxBit(l[5]&63)]) >>> 0;
  return (bitnumIntl(r,15,0)|bitnumIntl(r,6,1)|bitnumIntl(r,19,2)|bitnumIntl(r,20,3)|bitnumIntl(r,28,4)|bitnumIntl(r,11,5)|bitnumIntl(r,27,6)|bitnumIntl(r,16,7)|bitnumIntl(r,0,8)|bitnumIntl(r,14,9)|bitnumIntl(r,22,10)|bitnumIntl(r,25,11)|bitnumIntl(r,4,12)|bitnumIntl(r,17,13)|bitnumIntl(r,30,14)|bitnumIntl(r,9,15)|bitnumIntl(r,1,16)|bitnumIntl(r,7,17)|bitnumIntl(r,23,18)|bitnumIntl(r,13,19)|bitnumIntl(r,31,20)|bitnumIntl(r,26,21)|bitnumIntl(r,2,22)|bitnumIntl(r,8,23)|bitnumIntl(r,18,24)|bitnumIntl(r,12,25)|bitnumIntl(r,29,26)|bitnumIntl(r,5,27)|bitnumIntl(r,21,28)|bitnumIntl(r,10,29)|bitnumIntl(r,3,30)|bitnumIntl(r,24,31)) >>> 0;
}

function keySchedule(key, decrypt) {
  const schedule = Array.from({ length: 16 }, () => [0, 0, 0, 0, 0, 0]);
  const shifts = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
  const pc = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35];
  const pd = [62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3];
  const kc = [13,16,10,23,0,4,2,27,14,5,20,9,22,18,11,3,25,7,15,6,26,19,12,1,40,51,30,36,46,54,29,39,50,44,32,47,43,48,38,55,33,52,45,41,49,35,28,31];

  let c = 0;
  let d = 0;

  for (let i = 0; i < 28; i++) {
    c = (c + bitnum(key, pc[i], 31 - i)) >>> 0;
    d = (d + bitnum(key, pd[i], 31 - i)) >>> 0;
  }

  for (let i = 0; i < 16; i++) {
    c = (((c << shifts[i]) | (c >>> (28 - shifts[i]))) & 0xfffffff0) >>> 0;
    d = (((d << shifts[i]) | (d >>> (28 - shifts[i]))) & 0xfffffff0) >>> 0;
    const idx = decrypt ? 15 - i : i;

    for (let j = 0; j < 24; j++) {
      schedule[idx][Math.floor(j / 8)] |= bitnumIntr(c, kc[j], 7 - (j % 8));
    }

    for (let j = 24; j < 48; j++) {
      schedule[idx][Math.floor(j / 8)] |= bitnumIntr(d, kc[j] - 27, 7 - (j % 8));
    }
  }

  return schedule;
}

function cryptBlock(input, schedule) {
  let [s0, s1] = initialPermutation(input);

  for (let i = 0; i < 15; i++) {
    const previous = s1;
    s1 = (desF(s1, schedule[i]) ^ s0) >>> 0;
    s0 = previous;
  }

  s0 = (desF(s1, schedule[15]) ^ s0) >>> 0;
  return inversePermutation(s0, s1);
}

function qrcKeyBytes() {
  const bytes = [];
  for (let i = 0; i < QRC_KEY.length; i++) {
    bytes.push(QRC_KEY.charCodeAt(i) & 0xff);
  }
  return bytes;
}

function tripleDesDecrypt(bytes) {
  const key = qrcKeyBytes();
  const schedules = [
    keySchedule(key.slice(16, 24), true),
    keySchedule(key.slice(8, 16), false),
    keySchedule(key.slice(0, 8), true)
  ];

  const output = [];

  for (let i = 0; i + 8 <= bytes.length; i += 8) {
    let block = bytes.slice(i, i + 8);
    for (let k = 0; k < 3; k++) {
      block = cryptBlock(block, schedules[k]);
    }
    output.push.apply(output, block);
  }

  return output;
}

function hexToBytes(hexString) {
  const clean = String(hexString || "").replace(/[^0-9A-Fa-f]/g, "");
  const bytes = [];

  for (let i = 0; i + 1 < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16) & 0xff);
  }

  return bytes;
}

function decryptQrc(rawHexString) {
  const bytes = hexToBytes(rawHexString);
  if (!bytes.length || bytes.length % 8 !== 0) return "";
  return Platform.compression.inflateBytesToText(tripleDesDecrypt(bytes));
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, function(_, code) {
      return String.fromCharCode(Number(code));
    });
}

function parseQrcFormat(text) {
  if (!text) return [];

  let content = String(text || "");
  const xml = content.match(/<Lyric_1 LyricType="1" LyricContent="([\s\S]*?)"\/>/);
  if (xml) {
    content = decodeXmlEntities(xml[1] || "");
  }

  const result = [];

  content.split(/\r?\n/).forEach(rawLine => {
    const line = String(rawLine || "").trim();
    if (!line) return;

    // 对齐 master：跳过 [ti:xxx]、[ar:xxx] 等 tag 行。
    if (/^\[(\w+):([^\]]*)]$/.test(line)) return;

    const lineMatch = line.match(/^\[(\d+),(\d+)](.*)$/);
    if (!lineMatch) return;

    const lineStart = Number(lineMatch[1] || 0);
    const lineDuration = Number(lineMatch[2] || 0);
    const lineEnd = lineStart + lineDuration;
    const lineContent = lineMatch[3] || "";

    const wordList = [];
    const wordRe = /(?:^\[\d+,\d+])?((?:(?!\(\d+,\d+\)).)*)\((\d+),(\d+)\)/g;
    let wordMatch;

    while ((wordMatch = wordRe.exec(lineContent)) !== null) {
      const wordText = wordMatch[1] || "";
      const wordStart = Number(wordMatch[2] || 0);
      const duration = Number(wordMatch[3] || 0);

      // 这里不要过滤空文本。
      // QQ 罗马音里可能存在 "(299,37)" 这种只有时间片、没有文本的 word。
      // master 的 QrcParser 会保留空 LyricsWord，后续 merge 后表现为空文本，而不是把时间片当正文。
      wordList.push([wordStart, duration, wordText]);
    }

    const words = [];

    wordList.forEach((item, index) => {
      const wordStart = item[0];
      const duration = Number(item[1] || 0);
      const wordText = item[2];
      const wordEnd = duration > 0
        ? wordStart + duration
        : (index < wordList.length - 1 ? wordList[index + 1][0] : lineEnd);

      words.push([wordStart, wordEnd, wordText]);
    });

    if (!words.length) {
      words.push([lineStart, lineEnd, lineContent]);
    }

    result.push([lineStart, lineEnd, words]);
  });

  return result;
}

function parseLrcFormat(text) {
  if (!text) return null;

  const tempLines = [];

  String(text || "").split(/\r?\n/).forEach(rawLine => {
    const line = String(rawLine || "").trim();
    if (!line) return;

    // 对齐 master:
    // LRC_PATTERN = ^\[(\d+):(\d+\.\d+)](.*)$
    const match = line.match(/^\[(\d+):(\d+\.\d+)](.*)$/);
    if (!match) return;

    const minutes = Number(match[1] || 0);
    const seconds = Number(match[2] || 0);
    const start = Math.floor(minutes * 60 * 1000 + seconds * 1000);
    const content = match[3] || "";

    tempLines.push([start, content]);
  });

  if (!tempLines.length) return null;

  tempLines.sort((a, b) => a[0] - b[0]);

  return tempLines.map((current, index) => {
    const next = index < tempLines.length - 1 ? tempLines[index + 1] : null;
    const end = next ? Math.max(current[0], next[0] - 10) : current[0] + 2000;

    return [
      current[0],
      end,
      [[current[0], end, current[1]]]
    ];
  });
}

function compactWordsText(words) {
  return (Array.isArray(words) ? words : [])
    .map(word => Array.isArray(word) ? String(word[2] || "") : "")
    .join("");
}

function lyricsMerge(originalLines, transLines) {
  if (!Array.isArray(transLines) || !transLines.length) return null;

  const sortedTransLines = transLines
    .slice()
    .sort((a, b) => Number(a[0] || 0) - Number(b[0] || 0));

  const alignedList = [];
  let transIdx = 0;
  const transCount = sortedTransLines.length;

  for (let i = 0; i < originalLines.length; i++) {
    const orig = originalLines[i];

    const winStart = Number(orig[0] || 0);
    const origEnd = Number(orig[1] || winStart);
    const winEnd = i < originalLines.length - 1
      ? Number(originalLines[i + 1][0] || winStart)
      : Number.MAX_SAFE_INTEGER;

    let matchedText = "";

    while (transIdx < transCount) {
      const trans = sortedTransLines[transIdx];
      const transStart = Number(trans[0] || 0);

      if (transStart < winStart - 500) {
        transIdx++;
        continue;
      }

      if (transStart >= winEnd) {
        break;
      }

      matchedText = compactWordsText(trans[2]);
      transIdx++;
      break;
    }

    // translated / romanization 必须返回整行文本格式：
    // [lineStartMs, lineEndMs, "text"]
    //
    // 不能返回：
    // [lineStartMs, lineEndMs, [[wordStartMs, wordEndMs, "text"]]]
    //
    // 否则宿主 parseCompactTextLines() 会把第三项当成空文本过滤掉。
    alignedList.push([
      winStart,
      origEnd,
      matchedText
    ]);
  }

  return alignedList;
}

function decodeMaybeBase64(value) {
  if (!value) return "";

  try {
    return Platform.base64.decodeText(String(value));
  } catch (e) {
    return String(value);
  }
}

function decodeQqLyricPayload(value) {
  const raw = String(value || "");
  if (!raw) return "";

  const decrypted = decryptQrc(raw);
  if (decrypted) return decrypted;

  const decoded = decodeMaybeBase64(raw);
  return decoded || raw;
}

// ---------------------------------------------------------------------------
// 歌词
// ---------------------------------------------------------------------------
//
// 用户要求把歌词刮削加回来。QQ 音乐这边能同时拿到两档：
//   1. QRC（逐字）：musicu 的 PlayLyricInfo 返回一段加密的 QRC 文本；
//   2. LRC（逐行）：fcg_query_lyric_new 的明文歌词。
// 两条都会带上翻译（trans），由调用方决定要不要写进文件。
// 少了 Referer 腾讯会返回空内容，这一点和搜歌、搜头像是一样的。

function qqSearchSongs(keyword, limit) {
  const response = postMusicu("music.search.SearchCgiService", "DoSearchForQQMusicLite", {
    search_id: randomSearchId(),
    remoteplace: "search.android.keyboard",
    query: String(keyword || ""),
    search_type: 0,
    num_per_page: limit || 5,
    page_num: 1,
    highlight: 0,
    nqc_flag: 0,
    page_id: 1,
    grp: 1
  });
  return (((response.req_0 || {}).data || {}).body || {}).item_song || [];
}

function qqSongLabel(song) {
  const singers = Array.isArray(song.singer) ? song.singer.map(x => x.name || "").filter(Boolean) : [];
  const album = song.album || {};
  return {
    title: String(song.title || song.name || ""),
    artist: singers.join("/"),
    album: String(album.name || ""),
    mid: String(song.mid || ""),
    id: String(song.id || "")
  };
}

/** fcg_query_lyric_new：明文 LRC + 翻译。 */
function qqFetchLrc(mid) {
  try {
    const url = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg" +
      "?songmid=" + encodeURIComponent(mid) + "&format=json&nobase64=1&g_tk=5381";
    const text = Platform.http.getText(url, {
      headers: {
        "Referer": "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    const root = JSON.parse(String(text || "{}"));
    return {
      lyric: String(root.lyric || ""),
      trans: String(root.trans || "")
    };
  } catch (e) {
    return { lyric: "", trans: "" };
  }
}

/** musicu PlayLyricInfo：加密 QRC（逐字）+ 翻译。 */
function qqFetchQrc(mid, id, nameOf) {
  nameOf = nameOf || {};
  try {
    // 实测（node scripts/plugin-test.mjs）：不带 crypt/qrc 时返回的是
    // base64 的**逐行 LRC**，解出来干净可用；带上 crypt/qrc 之后
    // 返回的 QRC 是加密的，本插件包里的解密实现解不开，反而什么都拿不到。
    // 所以这里只请求逐行 + 翻译，逐字留给能解开 QRC 的源。
    const response = postMusicu("music.musichallSong.PlayLyricInfo", "GetPlayLyricInfo", {
      songMID: mid,
      songID: Number(id) || 0,
      format: 1,
      trans: 1
    });
    const data = (response.req_0 || {}).data || {};
    return {
      lyric: String(data.lyric || ""),
      trans: String(data.trans || "")
    };
  } catch (e) {
    return { lyric: "", trans: "" };
  }
}

function isQrcText(text) {
  return /<\d{1,3}:\d{1,2}/.test(String(text || ""));
}

/**
 * 这段文本像不像歌词。
 *
 * 必须判断：某些网络环境下接口会把响应压成二进制返回，直接当字符串用
 * 会得到一屏乱码，而且照样能被写进文件。判据两条 ——
 * 没有控制字符（有就说明是二进制），并且含 [mm:ss] 时间轴。
 */
function looksLikeLyrics(text) {
  const s = String(text || "");
  if (s.length < 4) return false;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) return false;
  return /\d{1,3}:\d{1,2}/.test(s);
}

function getLyrics(request) {
  try {
    const keyword = String(
      request.keyword ||
      ((request.title || "") + " " + (request.artist || "")).trim()
    ).trim();
    if (!keyword) return [];

    const songs = qqSearchSongs(keyword, 5);
    if (!songs.length) return [];

    // 逐条往下试，拿到第一条有歌词的就返回：搜索第一名未必是对的版本。
    for (let i = 0; i < songs.length; i++) {
      const info = qqSongLabel(songs[i]);
      if (!info.mid) continue;

      const out = [];

      /*
       * QQ 的歌词有两档，走同一个 musicu 接口：
       *   - 逐字（QRC）：解出来带 <mm:ss.ms> 标记；
       *   - 逐行（LRC）：解出来是标准 [mm:ss] 文本。
       * 到底给哪一档由服务端决定，所以**先解再判断**，别写死。
       */
      const qrcRaw = qqFetchQrc(info.mid, info.id, {
        title: info.title, artist: info.artist, album: info.album, duration: songs[i].duration || 0
      });
      const decoded = decodeQqLyricPayload(qrcRaw.lyric);
      const trans = decodeMaybeBase64(qrcRaw.trans);

      if (isQrcText(decoded)) {
        out.push({
          id: info.mid,
          title: info.title,
          artist: info.artist,
          album: info.album,
          type: "word",
          lyrics: decoded,
          translation: trans || "",
          internal: { qq_songmid: info.mid }
        });
        // 同一份 QRC 顺手给出逐行版本，用户想只要逐行时不必另找源。
        const plain = qrcPlainText(decoded);
        if (looksLikeLyrics(plain)) {
          out.push({
            id: info.mid,
            title: info.title,
            artist: info.artist,
            album: info.album,
            type: "line",
            lyrics: plain,
            translation: trans || "",
            internal: { qq_songmid: info.mid }
          });
        }
        return out;
      }

      if (looksLikeLyrics(decoded)) {
        out.push({
          id: info.mid,
          title: info.title,
          artist: info.artist,
          album: info.album,
          type: "line",
          lyrics: decoded,
          translation: trans || "",
          internal: { qq_songmid: info.mid }
        });
        return out;
      }

      // musicu 没给出可用内容时，退回明文那一路。
      const lrc = qqFetchLrc(info.mid);
      const lrcText = lrc.lyric ? decodeMaybeBase64(lrc.lyric) : "";
      const lrcTrans = lrc.trans ? decodeMaybeBase64(lrc.trans) : "";
      if (looksLikeLyrics(lrcText) && !isQrcText(lrcText)) {
        out.push({
          id: info.mid,
          title: info.title,
          artist: info.artist,
          album: info.album,
          type: "line",
          lyrics: lrcText,
          translation: lrcTrans || "",
          internal: { qq_songmid: info.mid }
        });
      }

      if (out.length) return out;
    }
    return [];
  } catch (e) {
    Platform.log.error("QQ音乐", "歌词获取失败：" + String(e && e.message ? e.message : e));
    return [];
  }
}

/** QRC → 标准 LRC（把逐字标记去掉）。 */
function qrcPlainText(qrc) {
  return String(qrc || "")
    .split(/\r?\n/)
    .map(function (line) {
      const m = line.match(/^\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/);
      if (!m) return "";
      const text = line.replace(/^\[[^\]]*\]/, "").replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim();
      return text ? "[" + m[1] + "]" + text : "";
    })
    .filter(Boolean)
    .join("\n");
}
