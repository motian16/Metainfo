# Metainfo —— MetaAudio 资源仓库

这个仓库给 [MetaAudio](https://github.com/motian16) 客户端提供两样东西：

1. **元信息标签规则** `rules/tag_rules.json`
2. **插件包** `plugins/*.zip`

软件里只需要填**一条**地址：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

## 目录

```
index.json                 总清单（软件里填的就是这一条地址）
rules/
    tag_rules.json         元信息标签规则（v5，group/key/value 格式）
    index.json             规则版本信息
plugins/
    qq.zip netease.zip kugou.zip apple.zip musicbrainz.zip
                           各个平台插件（含艺术家图片能力）
    Lyrico-Plugins-all.zip 一次装完所有插件
```

## index.json 怎么工作

```json
{
  "schema": 1,
  "include": [
    "https://api.github.com/repos/Replica0110/Lyrico-Plugins/releases/latest"
  ],
  "rules": "rules/tag_rules.json",
  "plugins": [ { "id": "...", "name": "...", "file": "plugins/xxx.zip", "versionCode": 1 } ]
}
```

- `include`：顺带把别人的清单也读一遍。上游 [Replica0110/Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins)
  走的是 GitHub Releases，`releases/latest` 返回的 JSON 里 `assets[].name` 自带插件 id 和版本号
  （例如 `com.qqmusic.source-0.4.2.zip`），所以能直接拿来比版本、下载、安装。
- `plugins[]`：本仓库自己的插件包，`file` 相对 `index.json` 所在目录。
- `rules`：标签规则地址，软件一键导入。

## 为什么要有这个仓库

上游 `Replica0110/Lyrico-Plugins` 提供 `searchSongs` / `getLyrics` / `searchCovers`，
但**没有艺术家图片能力**（`searchArtistImages`）。MetaAudio 的艺术家图刮削依赖这个能力，
所以这里的插件包是在上游基础上补了艺术家图片的版本，和上游的歌词、封面一起用。

## 更新方式

改完 `tag_rules.json` 后把 `rules/index.json` 里的 `version` +1，
客户端就能判断本地那份是不是旧的。
