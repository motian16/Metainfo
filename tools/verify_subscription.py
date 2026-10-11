# -*- coding: utf-8 -*-
"""发布后自检：订阅地址 → index.json → 订阅包 → 包内每个文件，一路校验 sha256。

跑法：

    python tools/verify_subscription.py

检查清单（任何一条对不上都会打印出来并以非 0 退出）：

1. index.json 拿得到、里有 `bundle`、`updatedAt` / `bundle.sha256` 齐全；
2. 订阅包**直连 github.com** 下得下来，整包 sha256 与公布的一致；
3. 订阅包**经镜像**下得下来（App 直连不通时的回退路线），内容与直连逐字节一致；
4. 解开订阅包：包内规则的 sha256 与 `bundle.rulesSha256` 一致、能解析出分组；
5. 每个插件条目在包里有同名文件、sha256 与条目一致、是个真 zip；
6. 每个插件条目**单独下载**也对得上（订阅包失败时的回退路线）。
"""
import hashlib
import io
import json
import sys
import urllib.request
import zipfile

INDEX = "https://raw.githubusercontent.com/motian16/Metainfo/main/index.json"

#: 订阅包走的中转（和 App 内置的那张表一致）。镜像站会变，定期用
#: tools/probe_mirrors.py 重新量一遍再改这里和 App 里的默认表。
MIRRORS = [
    "https://gh-proxy.com/",
    "https://ghfast.top/",
    "https://hk.gh-proxy.com/",
    "https://gh.llkk.cc/",
    "https://cdn.gh-proxy.com/",
]

bad = []


def fetch(url, timeout=120):
    request = urllib.request.Request(url, headers={"User-Agent": "MetaAudio-Verify"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def check(ok, label, extra=""):
    print(("  OK   " if ok else "  失败 ") + label + ("  " + extra if extra else ""))
    if not ok:
        bad.append(label)


print("1) 拉订阅清单 " + INDEX)
index = json.loads(fetch(INDEX).decode("utf-8"))
check("bundle" in index, "index.json 里有 bundle 字段")
check(bool(index.get("updatedAt")), "updatedAt 非空", str(index.get("updatedAt")))

bundle = index["bundle"]
url = bundle["url"]
print("   订阅包：" + url)
check(len(bundle.get("sha256", "")) == 64, "bundle.sha256 是 64 位", bundle.get("sha256", "")[:16] + "…")
check(bundle.get("rules") == "rules/tag_rules.json", "bundle.rules 指向包内规则", str(bundle.get("rules")))
check(len(bundle.get("rulesSha256", "")) == 64, "bundle.rulesSha256 是 64 位")

print("2) 直连 github.com 下订阅包")
data = fetch(url)
check(sha(data) == bundle["sha256"].lower(), "直连下载的整包 sha256 与公布一致",
      "%.2f MB" % (len(data) / 1048576.0))
check(len(data) == bundle.get("size", len(data)), "包大小与公布一致")

print("3) 镜像站（App 直连不通时的回退路线）")
for prefix in MIRRORS:
    try:
        mirror_data = fetch(prefix + url)
        check(sha(mirror_data) == bundle["sha256"].lower(), prefix + " 内容与直连一致")
    except Exception as error:
        check(False, prefix + " 下载失败", str(error)[:80])

print("4) 规则清单（没有订阅包时的回退来源）")
rules_entry = index.get("rules") or {}
if rules_entry.get("file"):
    # 分片清单是仓库里的 raw 文件：公布的 sha256 必须和 raw 上的**字节**一致
    #（换行被换成 CRLF 就会对不上，所以仓库里钉了 .gitattributes）。
    manifest_url = INDEX.rsplit("/", 1)[0] + "/" + rules_entry["file"]
    manifest_raw = fetch(manifest_url)
    check(sha(manifest_raw) == rules_entry.get("sha256", "").lower(),
          rules_entry["file"] + " 的 sha256 与公布一致")
    manifest = json.loads(manifest_raw.decode("utf-8"))
    check(len(manifest.get("files", [])) > 0, "规则清单列出了分片", str(len(manifest.get("files", []))) + " 片")
else:
    check(False, "index.json 里有 rules.file")

print("5) 解开订阅包，逐个对 sha256")
archive = zipfile.ZipFile(io.BytesIO(data))
names = set(archive.namelist())
rules_bytes = archive.read("rules/tag_rules.json")
check(sha(rules_bytes) == bundle.get("rulesSha256", "").lower(), "包内规则 sha256 与公布一致")
rules = json.loads(rules_bytes.decode("utf-8"))
check(rules.get("rulesVersion", 0) > 0, "包内规则有版本号", str(rules.get("rulesVersion")))
check(len(rules.get("groups", [])) > 0, "包内规则有分组", str(len(rules.get("groups", []))) + " 组")

for item in index["plugins"]:
    name = item["url"].rsplit("/", 1)[-1]
    if "plugins/" + name not in names:
        check(False, item["id"] + " 在订阅包里", name)
        continue
    inner = archive.read("plugins/" + name)
    check(sha(inner) == item["sha256"].lower(), item["id"] + " 包内 sha256 与条目一致")
    check(inner[:2] == b"PK", item["id"] + " 是个 zip")
    try:
        single = fetch(item["url"])
        check(sha(single) == item["sha256"].lower(), item["id"] + " 单独下载 sha256 一致")
    except Exception as error:
        check(False, item["id"] + " 单独下载失败", str(error)[:80])

print("6) 平台图标（元信息页每个分组左边那张图）")
icons = index.get("icons") or {}
icon_files = icons.get("files") or []
check(len(icon_files) >= 1, "index.json 公布了平台图标", str(len(icon_files)) + " 张")
aggregate = []
for item in icon_files:
    name = item["file"].rsplit("/", 1)[-1]
    if "icons/" + name not in names:
        check(False, "图标 " + name + " 在订阅包里")
        continue
    inner = archive.read("icons/" + name)
    ok_bundle = sha(inner) == item.get("sha256", "").lower()
    check(ok_bundle, "图标 " + name + " 包内 sha256 与条目一致")
    aggregate.append("%s %s\n" % (name, sha(inner)))
    # 订阅包取不到时的兜底路线：直接从仓库 raw 下这张图
    try:
        raw = fetch(INDEX.rsplit("/", 1)[0] + "/" + item["file"])
        check(sha(raw) == item.get("sha256", "").lower(), "图标 " + name + " 单独下载 sha256 一致")
    except Exception as error:
        check(False, "图标 " + name + " 单独下载失败", str(error)[:80])
if aggregate:
    expected = hashlib.sha256("".join(sorted(aggregate)).encode("utf-8")).hexdigest()
    check(expected == (icons.get("sha256") or "").lower(),
          "图标整批 sha256 与公布一致（App 靠它判断要不要更新）")

print()
if bad:
    print("有 %d 项没通过：" % len(bad))
    for item in bad:
        print("  - " + item)
    sys.exit(1)
print("全部通过：直连、镜像、整包、包内每个文件、单独回退包都对得上。")
