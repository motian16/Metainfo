# Metainfo

MetaAudio 的订阅源。App 里填这条地址：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

每次更新只下载一个 zip（`MetaAudio-Subscription.zip`）：

- `plugins/` 元信息源（上游 [Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins/releases) 的 `Lyrico-Plugins.zip`）+ 本仓库的艺术家图源
- `rules/tag_rules.json` 标签识别规则
- `icons/` 元信息页各分组的平台图标

`index.json` 里的 `bundle.md5` 用来判断要不要下载，`sha256` 用来校验下载到的文件。

## 目录

| 路径 | 内容 |
| --- | --- |
| `artistimage/` | 4 个艺术家图源的插件源码 |
| `rules/` | `rules.json` 是分片清单，`shared/`、`groups/` 是规则分片，`icons/` 是分组图标 |
| `tools/build.py` | 打订阅包、写 `index.json` |
| `tools/verify.py` | 发布后自检（下载 → 校验 → 解包比对） |
| `index.json` | 订阅清单 |

元信息源不在这里维护，只从上游取。

## 发布

```bash
python tools/build.py --tag v1.2.0
gh release create v1.2.0 build/MetaAudio-Subscription.zip -t "Metainfo v1.2.0"
python tools/verify.py
git commit -am "..." && git push
```

先发 Release，再推 `index.json`。

改 `rules/` 下的分片后，要同步 `rules/rules.json` 里对应的 `sha256`——`build.py` 会先校验，对不上直接报错。
