# Metainfo

MetaAudio 的订阅源。App 里填这条地址：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

更新时下载**三份独立资源**（外加几 KB 的 `index.json`）：

| 资源 | 内容 | 托管 |
| --- | --- | --- |
| `meta` | 上游 [Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins/releases) 的 `Lyrico-Plugins.zip`（元信息源 + 歌词 + 封面） | 上游 Release，外链 |
| `artistImage` | 本仓库 `artistimage/` 的 4 个艺术家图源 + `rules/icons/` → `ArtistImages.zip` | 本仓库 Release |
| `rules` | `rules/` 分片合并后的 `tag_rules.json`（标签识别规则） | 本仓库 Release |

`index.json` 里每一条都带 `sha256`；App 下载后逐份校验，任何一份对不上都不安装。
不再有 2 MB 的合集包，也不在本仓库复制上游搜索源。

## 目录

| 路径 | 内容 |
| --- | --- |
| `artistimage/` | 4 个艺术家图源的插件源码 |
| `rules/` | `rules.json` 是分片清单，`shared/`、`groups/` 是规则分片，`icons/` 是分组图标 |
| `tools/build.py` | 生成 `ArtistImages.zip`、`tag_rules.json`、`index.json` |
| `tools/verify.py` | 发布后自检（下载 → 校验 → 解包比对） |
| `index.json` | 订阅清单 |

## 发布

```bash
python tools/build.py --tag v1.3.0 \
  --meta-url https://github.com/Replica0110/Lyrico-Plugins/releases/download/v0.5.0/Lyrico-Plugins.zip \
  --meta-sha eed04426dced2409e0dee4b40a266ada4cbd2b6e834274fc2bcec30e2b8b58dd \
  --meta-version 0.5.0

gh release create v1.3.0 build/ArtistImages.zip build/tag_rules.json -t "Metainfo v1.3.0"
python tools/verify.py
git commit -am "..." && git push
```

先发 Release，再推 `index.json`。

改 `rules/` 下的分片后，要同步 `rules/rules.json` 里对应的 `sha256`——`build.py` 会先校验，对不上直接报错。
