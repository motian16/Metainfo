# 渊の插件源

MetaAudio 的一站式订阅源：填**一条地址**，元信息源、艺术家图源、标签识别规则一次装齐。

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

---

## 更新是怎么走的

1. App 拉上面这个 `index.json`（几 KB）；
2. 比版本：插件比本地新、或者标签规则那一份变了，才会往下走；
3. 下 **Release 里的那一个 zip**（`bundle`，约 1.6 MB）：

```
MetaAudio-Subscription.zip
    plugins/com.qqmusic.source-0.4.2.zip          元信息源（上游 Lyrico-Plugins）
    plugins/com.neteasecloudmusic.source-0.4.1.zip
    plugins/com.applemusic.source-0.4.1.zip
    plugins/com.kugou.source-0.4.1.zip
    plugins/com.musicbrainz.source-1.2.1.zip
    plugins/com.metaaudio.artistimage.qq.zip      艺术家图源（本仓库）
    plugins/com.metaaudio.artistimage.netease.zip
    plugins/com.metaaudio.artistimage.apple.zip
    plugins/com.metaaudio.artistimage.kugou.zip
    rules/tag_rules.json                          标签识别规则（合并好的完整一份）
```

4. 按 `sha256` 校验整包 → 解压 → 逐个装插件 + 落规则。**整次更新只有两次请求**。

下载顺序是 **github.com 原地址优先**，直连不通才自动换镜像（内置 jsDelivr 与
`gh-proxy.com` / `ghproxy.cn` / `ghfast.top` 三个中转，谁通用谁）。镜像拿到的内容
按仓库公布的 `sha256` 校验，对不上就换下一条。

订阅包取不到（没写 `bundle`、下载失败、校验不过、解压缺件）时**自动退回逐个下载**
`plugins[]` 里的包，所以老客户端、老仓库都照旧能用。

---

## 目录结构

```
index.json              订阅清单 —— 软件里填的就是这一条地址
LICENSE                 许可
README.md               本文件
rules/
    rules.json          规则清单：版本 + 分片列表（每个分片带 sha256）
    shared/             标准键 / 标准值 / 值别名（standard.json、labels.json）
    groups/             一个平台一个文件（qqmusic.json、netease.json…）
artistimage-src/        艺术家图源源码（直接可读、可改）
    qq/                 manifest.json / source.js / icon.png / locales/
    netease/  apple/  kugou/
plugins-src/            上游元信息源的源码副本（给人看的，仓库不发布它们）
tools/
    build_bundle.py     打包脚本：合并规则 → 打订阅包 → 更新 index.json
```

**插件包（zip）不放在仓库里**：它们由 `tools/build_bundle.py` 生成到 `build/`，
再上传到 [Releases](https://github.com/motian16/Metainfo/releases)。仓库里只留源码，
好处是随时能点进去看某一版改了什么，仓库也不会因为反复上传二进制而越变越大。

---

## index.json 说明

```json
{
  "schema": 1,
  "name": "渊の插件源",
  "updatedAt": "2026-10-11",
  "rules":  { "file": "rules/rules.json", "sha256": "…" },
  "bundle": {
    "url":         "https://github.com/motian16/Metainfo/releases/download/v2/MetaAudio-Subscription.zip",
    "sha256":      "…",
    "size":        1638356,
    "rules":       "rules/tag_rules.json",
    "rulesSha256": "…"
  },
  "plugins": [
    {
      "id": "com.metaaudio.artistimage.qq",
      "kind": "artistimage",
      "name": "QQ 音乐 艺术家图片",
      "versionName": "1.0.0",
      "versionCode": 1,
      "url": "https://github.com/motian16/Metainfo/releases/download/v2/com.metaaudio.artistimage.qq.zip",
      "src": "https://github.com/motian16/Metainfo/tree/main/artistimage-src/qq",
      "sha256": "…"
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `name` | **软件里显示的名字**，就是订阅那一行的标题 |
| `updatedAt` | 清单的日期。镜像缓存不一致时，App 靠它挑最新的那一份 |
| `bundle.url` | **订阅包地址**：元信息源 + 艺术家图源 + 标签规则都在里面 |
| `bundle.sha256` | 整包的校验值。对不上就换镜像重试，全部对不上就不装 |
| `bundle.rules` / `bundle.rulesSha256` | 包内那份规则的路径与校验值。App 直接落盘，不再逐个拉分片 |
| `rules` | 没有订阅包时的规则来源（分片清单），相对 `index.json` 所在目录 |
| `plugins[].url` | 没有订阅包时的逐个下载地址。App 比 `versionName`，只有更新才下载 |
| `plugins[].src` | 源码目录（给人看的，软件不用） |
| `plugins[].sha256` | 单包校验值；不写也能用（不校验） |

订阅包里取件靠**文件名**：`plugins[]` 里 `url` 的末段必须和包内文件名逐字一致。

顶层 `name` 随时可改，改完软件里显示的订阅名就跟着变。

---

## 发布新版本的流程

```powershell
python tools\build_bundle.py          # 合并规则 + 打订阅包 + 更新 index.json
python tools\build_bundle.py --check  # 校验 index.json 里的 sha256 对不对
```

脚本会自动做完这几件事：

1. 校验 `rules/rules.json` 里每个分片的 sha256，并把分片**合并**成一份完整规则；
2. 把 `artistimage-src/<平台>/` 重新打成 zip（`build/release/*.zip`）；
3. 从上游 Lyrico-Plugins 取元信息源包（缓存在 `build/upstream/`，`--refresh` 可强制重下）；
4. 打出 `build/MetaAudio-Subscription.zip`（`plugins/` + `rules/`）；
5. 更新 `index.json`：`updatedAt`、各包 `sha256`、订阅包地址与大小。

然后：

6. 新建 Release（例如 `v2`），把 `build/MetaAudio-Subscription.zip` 与
   `build/release/` 下的 4 个图源包传上去 —— **包名不要改**，`index.json` 与
   App 都按名字取件；
7. 提交并推送 `index.json`（改过源码的话连 `artistimage-src/`、`rules/` 一起提交）。

打包是**可重复**的：内容一样 → 字节一样 → sha256 一样，所以同一个版本重打一次
不会让 `index.json` 白改一遍。

> `index.json` 必须存成 **UTF-8 无 BOM**（脚本已经这么写）。带 BOM 的话软件会认为
> 它不是合法 JSON，整次订阅都会失败。

---

## 在软件里怎么用

1. **设置 → 插件 → 插件仓库** → 点那一行 → 填入上面的 `index.json` 地址
2. 点右边的刷新按钮 → 下载订阅包，比本地新的插件一次装齐、规则一并更新
3. **设置 → 插件 → 艺术家图源** → 确认四个插件都已启用
4. **设置 → 刮削 → 艺术家图片优先级** → 给它们排序（排在前面的一旦找到图就不再问后面的）

### 关于写入

软件默认**只补缺失的项**：已经有艺术家图的歌不会被覆盖。

---

## 许可

本项目内容采用 **MIT**，见 [LICENSE](LICENSE)。
