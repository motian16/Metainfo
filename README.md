# Metainfo

给 **MetaAudio**（Android 本地音乐标签工具）用的资源仓库。

**这个仓库只管两件事：**

1. **艺术家图片** —— 5 个只做「按艺术家搜图」的插件
2. **元信息标签规则** —— `rules/tag_rules.json`

**歌词和元信息（专辑艺术家、流派、音轨、碟号、作词、作曲、日期、版权、注释、BPM、ISRC、语言…）
全部来自上游 [Replica0110/Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins)，本仓库不重复提供。**
上游更新时客户端直接跟着上游更新，两边不会互相拖累。

软件里只需要填**一条**地址：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

---

## 为什么艺术家图片要单独放这里

上游提供 `searchSongs`（搜歌）、`getLyrics`（歌词）、`searchCovers`（封面），
但**没有艺术家图片能力**（`searchArtistImages`）。MetaAudio 的「刮削艺术家图片」依赖这个能力，
所以这里放 5 个**只实现 `searchArtistImages`** 的小插件 ——
它们里面**没有**任何搜歌、歌词、封面的代码，和上游插件是并存关系，不是替代关系。

装上之后：

| 内容 | 由谁提供 |
| --- | --- |
| 歌词 | 上游插件（`com.qqmusic.source` 等） |
| 元信息（专辑艺术家 / 流派 / 音轨 / 碟号 / 作词 / 作曲 / 日期 / 版权 / 注释 / BPM / ISRC / 语言…） | 上游插件 |
| 封面 | 上游插件 |
| **艺术家图片** | **本仓库的 `com.metaaudio.artistimage.*`** |
| 标签识别规则（别名、说明、平台归类） | **本仓库的 `rules/tag_rules.json`** |

---

## 目录结构

```
index.json                  总清单 —— 软件里填的就是这一条地址
LICENSE                     MIT（第三方内容的说明见文件末尾）
README.md                   本文件
rules/
    tag_rules.json          元信息标签规则（v5，group / key / value 格式）
    index.json              规则版本信息
plugins/
    qq.zip                  com.metaaudio.artistimage.qq
    netease.zip             com.metaaudio.artistimage.netease
    kugou.zip               com.metaaudio.artistimage.kugou
    apple.zip               com.metaaudio.artistimage.apple
    musicbrainz.zip         com.metaaudio.artistimage.musicbrainz
plugins-src/                五个插件的源码（仅供参考）
_参考不上传/                 上游原版包、上游插件副本 —— 都不上传到 GitHub
```

每个 zip 内部是一层同名目录（`qq/manifest.json`、`qq/source.js`…），这是插件安装器认的结构。

---

## index.json 说明

```json
{
  "schema": 1,
  "include": [
    "https://api.github.com/repos/Replica0110/Lyrico-Plugins/releases/latest"
  ],
  "rules": "rules/tag_rules.json",
  "plugins": [
    { "id": "com.metaaudio.artistimage.qq", "name": "QQ 音乐 艺术家图片",
      "file": "plugins/qq.zip", "versionCode": 1 }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `include` | 顺带把上游的清单也读一遍。上游走 GitHub Releases，`releases/latest` 返回的 JSON 里 `assets[].name` 自带插件 id 与版本号（例如 `com.qqmusic.source-0.4.2.zip`），客户端据此比版本、下载、安装 |
| `rules` | 标签规则地址，相对 `index.json` 所在目录 |
| `plugins[]` | 本仓库的艺术家图片插件。`file` 相对 `index.json`，也可以写完整 `url` |
| `plugins[].versionCode` | 整数，只有比本地新才会下载 |

---

## 标签规则是什么、不是什么

**是**：一份"给已经扫出来的标签补充含义"的对照表 —— 别名、说明、属于哪个平台/工具、某些值的译名。
它让「设置 - 音乐库 - 元信息」页把 `TXXX:QMQuality` 显示成「QQ 音乐 · 音质」而不是一串生键名。

**不是**：识别的白名单。客户端会把文件里**实际存在的所有非基本标签**都识别出来，
规则里没提到的键也照常显示（归到「未知标签」组），只是没有别名和说明。
所以规则可以慢慢补，不会因为漏了一条就"看不到"。

基本标签（歌曲名、艺术家、专辑、音轨号、碟号、流派、日期、封面、歌词等）由客户端内置名单排除，
不需要在规则里重复声明。

改完规则后把 `rules/index.json` 里的 `version` +1，客户端就能判断本地那份是不是旧的。

---

## 在软件里怎么用

1. **设置 → 插件 → 插件仓库** → 点右侧编辑图标 → 填上面的 `index.json` 地址 → 保存
2. 点右侧刷新图标 → 检查更新（会同时拉到上游的歌词/元信息插件和这里的艺术家图片插件）
3. **设置 → 刮削 → 标签识别规则** → 填 `rules/tag_rules.json` 的地址 → 导入
4. **设置 → 刮削 → 艺术家图片优先级** → 给这 5 个插件排序

### 关于写入

客户端默认**只补缺失的项**：文件里已经有值的字段不会被覆盖，只有空着的才由源补上。
想强制覆盖要另外开设置里的对应开关。

---

## 许可

本仓库自己编写的内容（`index.json`、`rules/`、`README.md`、`plugins-src/`）采用 **MIT**，见 [LICENSE](LICENSE)。

**注意**：艺术家图片插件里的平台接口调用方式参考了
[Replica0110/Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins)，
**该上游仓库目前没有声明任何许可证**。本仓库仅为个人使用与学习目的托管，
正式分发或商用前请先联系上游作者取得授权。
