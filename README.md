# Metainfo

给 **MetaAudio**（Android 本地音乐标签工具）用的资源仓库。

**这个仓库只管两件事：**

1. **艺术家图片** —— 4 个只做「按艺术家搜图」的插件
2. **元信息标签规则** —— `rules/tag_rules.json`

**歌词和元信息（专辑艺术家、流派、音轨、碟号、作词、作曲、日期、版权、注释、BPM、ISRC、语言…）
全部来自上游 [Replica0110/Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins)，本仓库不重复提供。**
上游更新时客户端直接跟着上游更新，两边不会互相拖累。

软件里只需要填**一条**地址：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

> **国内网络**：直连 `raw.githubusercontent.com` 通常是 DNS 污染。填 raw 地址就行 ——
> 客户端自己会改用 jsDelivr 取同一份内容（依次试 `cdn.jsdelivr.net` → `fastly.jsdelivr.net`
> → `gcore.jsdelivr.net` → `testingcf.jsdelivr.net`），不需要用户配代理；
> 也可以直接填 jsDelivr 形式：`https://cdn.jsdelivr.net/gh/motian16/Metainfo@main/index.json`。
> 详情见下面的「镜像与校验」。

---

## 为什么艺术家图片要单独放这里

上游提供 `searchSongs`（搜歌）、`getLyrics`（歌词）、`searchCovers`（封面），
但**没有艺术家图片能力**（`searchArtistImages`）。MetaAudio 的「刮削艺术家图片」依赖这个能力，
所以这里放 4 个**只实现 `searchArtistImages`** 的小插件 ——
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
    apple.zip               com.metaaudio.artistimage.apple
_参考不上传/                 上游原版包、上游插件副本 —— 都不上传到 GitHub

> MusicBrainz 没有做艺术家图片插件：Cover Art Archive 只支持 release / release-group，/artist/... 返回 400，MusicBrainz 本身不提供艺术家头像。与其写一张错的图进去，不如少一个源。
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
  "rules": {
    "file": "rules/tag_rules.json",
    "sha256": "8d2b961177b394979b993020b18b80aa92c21e52de5e11f72caca1f20811749f"
  },
  "plugins": [
    { "id": "com.metaaudio.artistimage.qq", "name": "QQ 音乐 艺术家图片",
      "file": "plugins/qq.zip", "versionCode": 1,
      "sha256": "4e8244dcc61c8cff00a3c88ecc2c979a85ca0017beb697216c9d9882941bddbf" }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `include` | 顺带把上游的清单也读一遍。上游走 GitHub Releases，`releases/latest` 返回的 JSON 里 `assets[].name` 自带插件 id 与版本号（例如 `com.qqmusic.source-0.4.2.zip`），客户端据此比版本、下载、安装 |
| `rules` | 标签规则地址，相对 `index.json` 所在目录。**可写字符串**（老写法），也可写成 `{ "file": …, "sha256": … }` 对象 |
| `rules.sha256` | 规则文件的 sha256（可选）。客户端更新订阅时记下它，用户之后导入**同一个文件**时自动逐字校验，不必手工抄 |
| `plugins[]` | 本仓库的艺术家图片插件。`file` 相对 `index.json`，也可以写完整 `url` |
| `plugins[].versionCode` | 整数，只有比本地新才会下载 |
| `plugins[].sha256` | 插件包的 sha256（可选）。写了就校验，对不上当这次下载失败、换下一个镜像 |

### 镜像与校验

国内访问 GitHub 的几种典型故障（DNS 污染、连接被重置、超时）客户端会自己绕：

1. **原地址**先试一次；
2. `raw.githubusercontent.com/…` 自动换成 jsDelivr 的
   `https://cdn.jsdelivr.net/gh/<user>/<repo>@<分支>/<路径>`，再依次试 `fastly.` / `gcore.` / `testingcf.`
   这几个入口（同一份内容，内容逐字节一致）；
3. `github.com` 的页面地址（`blob` / `raw` 形式会先换成 jsDelivr gh 形式）与
   `api.github.com` 接口地址这类 jsDelivr 服务不了的内容，才轮到用户自己在
   **「设置 - 网络与镜像」**里加的中转前缀（默认 `https://gh-proxy.com/`、`https://ghfast.top/`），
   拼法是 `前缀 + 原地址`；
4. 第一次成功后记住生效的那条，下次优先试它。

**校验**：中转站是第三方服务，转发的内容它有能力替换。所以本仓库在 `index.json` 里
为每个 zip 和规则文件都写了 `sha256`；客户端下载完立刻比对，对不上就换下一个镜像，
全都对不上时报「下载内容校验失败，可能被中间人篡改」。

三点要注意：

- **改了任何 zip 或 `tag_rules.json`，必须同步更新对应的 `sha256`**，否则所有客户端都会
  拒绝下载（这正是它的作用）。重新计算：
  ```powershell
  Get-FileHash plugins\qq.zip -Algorithm SHA256          # 插件包
  Get-FileHash rules\tag_rules.json -Algorithm SHA256    # 标签规则
  ```
  （Linux/macOS 用 `sha256sum 文件`。）
- **jsDelivr 对分支地址有缓存**（`@main` 大约 12 小时）。刚推完新文件时，客户端可能拿到
  "新 index.json + 缓存的旧 zip"，这时校验会失败并提示「下载内容校验失败，可能被中间人篡改」——
  不是被攻击，是缓存没同步。要么等缓存过期，要么去
  <https://www.jsdelivr.com/tools/purge> 手动刷新这几个文件。
- `sha256` 是**可选**字段，不写就照旧不校验 —— 老 index.json 不会因为缺字段而失效。
  它不是签名，挡不住"把 index.json 和 zip 一起换掉"的攻击，只挡得住"只改内容"的中转。

**设置在哪**：「设置 - 网络与镜像」里有上次生效的地址、可编辑的中转前缀列表，
以及一个「测试连接」按钮 —— 它会把当前仓库/规则地址的每个候选都试一遍，
逐条报出「通 / 不通」、字节数和耗时，用来判断到底是地址写错了还是被墙了。

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
   （订阅了本仓库的话，`rules.sha256` 已经自动记下来了，导入时会顺带校验，不用手填）
4. **设置 → 刮削 → 艺术家图片优先级** → 给这 4 个插件排序
5. 连不上时：**设置 → 网络与镜像** → 「测试连接」，看哪条镜像通；也可以自己加中转前缀

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