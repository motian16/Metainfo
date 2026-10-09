# 渊の插件源

MetaAudio 的艺术家图片源。

软件里填这一条地址即可：

```
https://raw.githubusercontent.com/motian16/Metainfo/main/index.json
```

---

## 这个源是干什么的

给 MetaAudio 提供**艺术家图片**：按歌手名字搜到这位歌手的照片，写进音乐文件的标签里
（或存成文件夹里的图片）。支持四个平台：

| 插件 | 平台 |
| --- | --- |
| `com.metaaudio.artistimage.qq` | QQ 音乐 |
| `com.metaaudio.artistimage.netease` | 网易云音乐 |
| `com.metaaudio.artistimage.kugou` | 酷狗音乐 |
| `com.metaaudio.artistimage.apple` | Apple Music |

这四个插件**只做艺术家图片这一件事** —— 里面没有搜歌、没有歌词、没有封面代码。

---

## 目录结构

```
index.json          清单 —— 软件里填的就是这一条地址
LICENSE             许可
README.md           本文件
rules/
    tag_rules.json  元信息标签规则
    index.json      规则版本信息
plugins/            解压后的插件源码（直接可读、可改）
    qq/             manifest.json / source.js / icon.png / locales/
    netease/
    kugou/
    apple/
```

**插件包（zip）不放在这里**，放在 Releases 里。仓库里只留源码，好处是：

- 随时能点进去看某一版到底改了什么，不用先解压；
- 仓库不会因为反复上传二进制而越变越大。

装插件用的 zip 在 [Releases](https://github.com/motian16/Metainfo/releases) 里下载，
`index.json` 里的 `url` 已经指向它们，软件会自动去取。

---

## index.json 说明

```json
{
  "schema": 1,
  "name": "渊の插件源",
  "rules": "rules/tag_rules.json",
  "plugins": [
    {
      "id": "com.metaaudio.artistimage.qq",
      "name": "QQ 音乐 艺术家图片",
      "versionName": "1.0.0",
      "versionCode": 1,
      "url": "https://github.com/motian16/Metainfo/releases/download/v1/com.metaaudio.artistimage.qq.zip",
      "src": "https://github.com/motian16/Metainfo/tree/main/plugins/qq",
      "sha256": "4e8244dc…"
    }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `name` | **软件里显示的名字**，就是订阅那一行的标题 |
| `rules` | 标签规则地址，相对 `index.json` 所在目录 |
| `plugins[].url` | 插件包地址。软件对比 `versionCode`，只有比本地新才下载 |
| `plugins[].src` | 源码目录（给人看的，软件不用） |
| `plugins[].sha256` | 下载后校验，对不上就换通道重试；不写也能用 |

顶层 `name` 随时可改，改完软件里显示的订阅名就跟着变。

---

## 发布新版本的流程

1. 改 `plugins/<平台>/` 里的源码；
2. 把目录重新打成 zip，**zip 里保留一层同名目录**（`qq/manifest.json`、`qq/source.js`…）——
   这是安装器认的结构；
3. 在 Releases 发布新版本（例如 `v2`），把 4 个 zip 传上去；
4. 更新 `index.json`：`versionCode` +1、`url` 里的版本号改掉、`sha256` 换成新包的。

`sha256` 用这条命令拿：

```powershell
Get-FileHash .\com.metaaudio.artistimage.qq.zip -Algorithm SHA256
```

> `index.json` 必须存成 **UTF-8 无 BOM**。带 BOM 的话软件会认为它不是合法 JSON，整次订阅都会失败。

---

## 在软件里怎么用

1. **设置 → 插件 → 插件仓库** → 点那一行 → 填入上面的 `index.json` 地址
2. 点右边的刷新按钮 → 软件只下载比你本地更新的插件
3. **设置 → 插件 → 艺术家图源** → 确认四个插件都已启用
4. **设置 → 刮削 → 艺术家图片优先级** → 给它们排序（排在前面的一旦找到图就不再问后面的）

### 关于写入

软件默认**只补缺失的项**：已经有艺术家图的歌不会被覆盖。

---

## 许可

本项目内容采用 **MIT**，见 [LICENSE](LICENSE)。
