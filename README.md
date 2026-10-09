# Metainfo

给 **MetaAudio**（Android 本地音乐标签工具）用的资源仓库：**元信息标签规则** + **插件包**。

软件里只需要填**一条**地址：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

> 用了 GitHub Pages 的话也可以用 `https://motian16.github.io/Metainfo/index.json`（需要在仓库
> Settings → Pages 里把 Source 设成 `main` 分支的 `/ (root)`）。

---

## 这个仓库解决什么问题

MetaAudio 从某个版本开始**不再把标签规则打进 APK**，插件也改为按需安装，所以需要一个
可以随时更新、用户填一个地址就能拉到的地方。这个仓库就是那个地方。

另外，上游 [Replica0110/Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins)
提供 `searchSongs`（搜歌）、`getLyrics`（歌词）、`searchCovers`（封面），
但**没有艺术家图片能力**（`searchArtistImages`）。MetaAudio 的「刮削艺术家图片」依赖这个能力，
所以 `plugins/` 里的插件包是在上游基础上**补了艺术家图片**的版本，可以和上游的歌词/封面一起用。

---

## 目录结构

```
index.json                  总清单 —— 软件里填的就是这一条地址
LICENSE                     MIT（第三方插件包的说明见文件末尾）
README.md                   本文件
rules/
    tag_rules.json          元信息标签规则（v5，group / key / value 格式）
    index.json              规则版本信息
plugins/
    qq.zip                  QQ 音乐
    netease.zip             网易云音乐
    kugou.zip               酷狗音乐
    apple.zip               Apple Music / iTunes
    musicbrainz.zip         MusicBrainz
    Lyrico-Plugins-all.zip  以上全部，一次装完
```

每个 zip 内部是一层同名目录（`qq/manifest.json`、`qq/source.js`…），
这是插件安装器认的结构。`Lyrico-Plugins-all.zip` 里是多层目录，可以一次装多个插件。

---

## index.json 说明

```json
{
  "schema": 1,
  "name": "MetaAudio 资源",
  "updatedAt": "2026-10-09",
  "include": [
    "https://api.github.com/repos/Replica0110/Lyrico-Plugins/releases/latest"
  ],
  "rules": "rules/tag_rules.json",
  "plugins": [
    { "id": "com.qqmusic.source", "name": "QQ 音乐（含艺术家图片）",
      "file": "plugins/qq.zip", "versionCode": 1 }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `include` | 顺带把别人的清单也读一遍。上游走 GitHub Releases，`releases/latest` 返回的 JSON 里 `assets[].name` 自带插件 id 与版本号（例如 `com.qqmusic.source-0.4.2.zip`），所以能直接拿来比版本、下载、安装 |
| `rules` | 标签规则地址，相对 `index.json` 所在目录 |
| `plugins[]` | 本仓库自己的插件包。`file` 相对 `index.json`，也可以直接写完整 `url` |
| `plugins[].versionCode` | 整数，用来判断要不要更新；只有比本地新才会下载 |

---

## 标签规则是什么、不是什么

**是**：一份"给已经扫出来的标签补充含义"的对照表 —— 别名、说明、属于哪个平台/工具、
某些值的译名。它让「设置 - 音乐库 - 元信息」页把
`TXXX:QMQuality` 显示成「QQ 音乐 · 音质」而不是一串生键名。

**不是**：识别的白名单。软件会把文件里**实际存在的所有非基本标签**都识别出来，
规则里没提到的键也会照常显示（归到「未知标签」组），只是没有别名和说明。
所以规则可以慢慢补，不会因为漏了一条就"看不到"。

基本标签（歌曲名、艺术家、专辑、音轨号、碟号、流派、日期、封面、歌词等）由软件内置名单排除，
不需要在规则里重复声明。

改完规则后，把 `rules/index.json` 里的 `version` +1，客户端就能判断本地那份是不是旧的。

---

## 在软件里怎么用

1. **设置 → 插件 → 插件仓库** → 点右侧编辑图标 → 填上面的 `index.json` 地址 → 保存
2. 点右侧刷新图标 → 检查更新 → 有新版本才下载安装
3. **设置 → 刮削 → 标签识别规则** → 填入 `rules/tag_rules.json` 的地址 → 导入

---

## 许可

本仓库自己编写的内容（`index.json`、`rules/`、`README.md`）采用 **MIT**，见 [LICENSE](LICENSE)。

**注意**：`plugins/` 下的插件包是在 [Replica0110/Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins)
基础上移植扩展的，**该上游仓库目前没有声明任何许可证**，因此这些插件包的再分发权利并不明确。
本仓库仅为个人使用与学习目的托管，正式分发或商用前请先联系上游作者取得授权。
