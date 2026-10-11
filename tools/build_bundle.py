#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包「一条订阅 = 一个 zip」。

产物（都在 build/ 下）：

    build/tag_rules.json                  合并好的标签规则（App 直接落盘的那一份）
    build/MetaAudio-Subscription.zip      订阅包：元信息源 + 艺术家图源 + 标签规则
    build/upstream/*.zip                  从 Lyrico-Plugins 取回的元信息源原件（缓存）
    index.json                            就地更新（订阅清单，指向 Release 里的上面那个 zip）

订阅包里的目录结构（App 按「文件名」取件，所以名字必须和 index.json 里 url 的
末段逐字一致）：

    plugins/com.qqmusic.source-0.4.2.zip
    plugins/com.neteasecloudmusic.source-0.4.1.zip
    plugins/com.applemusic.source-0.4.1.zip
    plugins/com.kugou.source-0.4.1.zip
    plugins/com.musicbrainz.source-1.2.1.zip
    plugins/com.metaaudio.artistimage.qq.zip
    plugins/com.metaaudio.artistimage.netease.zip
    plugins/com.metaaudio.artistimage.kugou.zip
    plugins/com.metaaudio.artistimage.apple.zip
    rules/tag_rules.json

用法：

    python tools/build_bundle.py                 # 打包并更新 index.json
    python tools/build_bundle.py --tag v3        # 换一个 Release 标签
    python tools/build_bundle.py --check         # 只校验 index.json 里的 sha256 对不对
    python tools/build_bundle.py --refresh       # 忽略缓存，重新下载元信息源

打包是**可重复**的：zip 里的时间戳固定，内容一样 → 字节一样 → sha256 一样。
"""

import argparse
import datetime
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
UPSTREAM = os.path.join(BUILD, "upstream")
#: 待上传到 Release 的成品：订阅包 + 4 个艺术家图源包。
RELEASE = os.path.join(BUILD, "release")
RULES_DIR = os.path.join(ROOT, "rules")
ARTIST_SRC = os.path.join(ROOT, "artistimage-src")

#: 仓库地址（Release 与 raw 都在这个仓库里）。
REPO = "motian16/Metainfo"
#: 订阅包与艺术家图源包所在的 Release 标签。
DEFAULT_TAG = "v2"
#: 订阅包在 Release 里的文件名。
BUNDLE_NAME = "MetaAudio-Subscription.zip"

#: 元信息源：直接指向上游 Lyrico-Plugins 的发布包，本仓库只把它们收进订阅包。
META_TAG = "v0.4.0"
META_BASE = "https://github.com/Replica0110/Lyrico-Plugins/releases/download/" + META_TAG
META = [
    ("com.qqmusic.source", "QQ音乐", "0.4.2", 8, "com.qqmusic.source-0.4.2.zip"),
    ("com.neteasecloudmusic.source", "网易云音乐", "0.4.1", 9, "com.neteasecloudmusic.source-0.4.1.zip"),
    ("com.applemusic.source", "Apple Music", "0.4.1", 8, "com.applemusic.source-0.4.1.zip"),
    ("com.kugou.source", "酷狗音乐", "0.4.1", 7, "com.kugou.source-0.4.1.zip"),
    ("com.musicbrainz.source", "MusicBrainz", "1.2.1", 5, "com.musicbrainz.source-1.2.1.zip"),
]

#: 艺术家图源：源码在本仓库 artistimage-src/ 下，打包后放进 Release。
ARTIST = [
    ("com.metaaudio.artistimage.qq", "QQ 音乐 艺术家图片", "qq", "1.0.0", 1),
    ("com.metaaudio.artistimage.netease", "网易云音乐 艺术家图片", "netease", "1.0.0", 1),
    ("com.metaaudio.artistimage.apple", "Apple Music 艺术家图片", "apple", "1.0.0", 1),
    ("com.metaaudio.artistimage.kugou", "酷狗音乐 艺术家图片", "kugou", "1.0.0", 1),
]

#: 合并规则时，哪些顶层字段是「数组拼接」、哪些是「对象按键合并」。
#: 必须和 App 里的 RuleBundle 保持一致（App 只有在没有订阅包时才会自己合并分片）。
ARRAY_KEYS = ("groups", "hints")
OBJECT_KEYS = (
    "standard", "standardValues", "valueLabels", "valueLabelPatterns",
    "valueInfoPatterns", "valueAliases", "keyInfo",
)

#: zip 里所有条目的固定时间戳：内容一样就打出一模一样的字节。
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str) -> str:
    with open(path, "rb") as handle:
        return sha256_bytes(handle.read())


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8-sig") as handle:
        return handle.read()


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # UTF-8**无 BOM**：带 BOM 的话 App 会把整个 index.json 判成非法 JSON。
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


# ----------------------------------------------------------------------
# 规则：校验分片 → 合并成一份
# ----------------------------------------------------------------------

def merge_rules() -> tuple:
    """把 rules/rules.json 与各分片合并成一份完整规则。

    @return (合并后的文本, 合并后的 sha256, 清单 sha256)
    """
    manifest_path = os.path.join(RULES_DIR, "rules.json")
    manifest_text = read_text(manifest_path)
    manifest = json.loads(manifest_text)
    manifest_sha = sha256_bytes(manifest_text.encode("utf-8"))

    out = {}
    for key, value in manifest.items():
        if key != "files":
            out[key] = value

    for entry in manifest.get("files", []):
        rel = entry["file"]
        path = os.path.join(RULES_DIR, rel.replace("/", os.sep))
        if not os.path.isfile(path):
            raise SystemExit("规则分片不存在：" + rel)
        actual = sha256_file(path)
        expected = (entry.get("sha256") or "").lower()
        if expected and actual != expected:
            raise SystemExit(
                "规则分片 sha256 对不上：%s\n  清单写的是 %s\n  实际是     %s\n"
                "（改过分片就要在 rules/rules.json 里同步更新）" % (rel, expected, actual)
            )
        part = json.loads(read_text(path))
        for key, value in part.items():
            if key in ARRAY_KEYS:
                out[key] = list(out.get(key) or []) + list(value or [])
            elif key in OBJECT_KEYS:
                merged = dict(out.get(key) or {})
                merged.update(value or {})
                out[key] = merged
            elif key not in out:
                out[key] = value

    # 落盘顺序稳定：排序键，中文不进 ASCII 转义，方便人看。
    merged_text = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    return merged_text, sha256_bytes(merged_text.encode("utf-8")), manifest_sha


# ----------------------------------------------------------------------
# 打包
# ----------------------------------------------------------------------

def zip_dir_deterministic(src_dir: str, prefix: str) -> bytes:
    """把一个插件源码目录打成 zip，保留一层同名目录（App 的安装器认这个结构）。"""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for folder, _, files in os.walk(src_dir):
            for name in sorted(files):
                full = os.path.join(folder, name)
                rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
                info = zipfile.ZipInfo(prefix + "/" + rel, date_time=FIXED_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                with open(full, "rb") as handle:
                    archive.writestr(info, handle.read())
    return out.getvalue()


def fetch(url: str, path: str, refresh: bool) -> bytes:
    """下载并缓存（缓存命中就直接用，不联网）。"""
    if not refresh and os.path.isfile(path):
        with open(path, "rb") as handle:
            data = handle.read()
        if data:
            print("    用缓存 " + os.path.basename(path) + "（%d 字节）" % len(data))
            return data
    print("    下载 " + url)
    request = urllib.request.Request(url, headers={"User-Agent": "MetaAudio-Repo-Builder"})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    return data


def build(tag: str, refresh: bool, updated_at: str) -> dict:
    os.makedirs(UPSTREAM, exist_ok=True)

    print("1/4 合并标签规则")
    merged_text, merged_sha, manifest_sha = merge_rules()
    merged_path = os.path.join(BUILD, "tag_rules.json")
    write_text(merged_path, merged_text)
    print("    rulesVersion=%s，%d 字节，sha256=%s"
          % (json.loads(merged_text).get("rulesVersion"), len(merged_text.encode("utf-8")), merged_sha[:16]))

    print("2/4 打包艺术家图源（源码在 artistimage-src/）")
    os.makedirs(RELEASE, exist_ok=True)
    artist_files = {}
    for plugin_id, _, folder, _, _ in ARTIST:
        data = zip_dir_deterministic(os.path.join(ARTIST_SRC, folder), folder)
        # 和 Release 里的资产名一致：App 按 url 末段在订阅包里取件，名字必须逐字对上。
        artist_files[folder] = data
        with open(os.path.join(RELEASE, plugin_id + ".zip"), "wb") as handle:
            handle.write(data)
        print("    %-40s %6d 字节  %s" % (plugin_id + ".zip", len(data), sha256_bytes(data)[:16]))

    print("3/4 取元信息源（上游 Lyrico-Plugins " + META_TAG + "）")
    meta_files = {}
    for _, _, _, _, name in META:
        data = fetch(META_BASE + "/" + name, os.path.join(UPSTREAM, name), refresh)
        meta_files[name] = data
        print("    %-45s %7d 字节  %s" % (name, len(data), sha256_bytes(data)[:16]))

    print("4/4 打订阅包 " + BUNDLE_NAME)
    bundle = io.BytesIO()
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        def add(path: str, data: bytes, store: bool = False) -> None:
            info = zipfile.ZipInfo(path, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)

        # 元信息源与图源本身已经是压缩过的 zip，再压一遍只是浪费时间。
        for name, data in meta_files.items():
            add("plugins/" + name, data, store=True)
        for entry in ARTIST:
            plugin_id, _, folder, _, _ = entry
            add("plugins/" + plugin_id + ".zip", artist_files[folder], store=True)
        add("rules/tag_rules.json", merged_text.encode("utf-8"))

    bundle_bytes = bundle.getvalue()
    bundle_sha = sha256_bytes(bundle_bytes)
    bundle_path = os.path.join(BUILD, BUNDLE_NAME)
    with open(bundle_path, "wb") as handle:
        handle.write(bundle_bytes)
    print("    订阅包 %d 字节（%.2f MB），sha256=%s"
          % (len(bundle_bytes), len(bundle_bytes) / 1048576.0, bundle_sha))

    # ------------------------------------------------------------------
    # index.json
    # ------------------------------------------------------------------
    release_base = "https://github.com/%s/releases/download/%s/" % (REPO, tag)
    plugins = []
    for plugin_id, name, version_name, version_code, file_name in META:
        plugins.append({
            "id": plugin_id,
            "kind": "meta",
            "name": name,
            "versionName": version_name,
            "versionCode": version_code,
            "url": META_BASE + "/" + file_name,
            "sha256": sha256_bytes(meta_files[file_name]),
        })
    for plugin_id, name, folder, version_name, version_code in ARTIST:
        plugins.append({
            "id": plugin_id,
            "kind": "artistimage",
            "name": name,
            "versionName": version_name,
            "versionCode": version_code,
            "url": release_base + plugin_id + ".zip",
            "src": "https://github.com/%s/tree/main/artistimage-src/%s" % (REPO, folder),
            "sha256": sha256_bytes(artist_files[folder]),
        })

    index = {
        "schema": 1,
        "name": "渊の插件源",
        "updatedAt": updated_at,
        "note": (
            "订阅这一条地址即可：更新时只下载 bundle 那一个 zip —— 里面已经装好了"
            "元信息源、艺术家图源和标签识别规则，App 一次请求全部装齐。"
            "bundle 取不到时才回退到逐个下载 plugins[] 里的包（老客户端也能用）。"
            "元信息源的源码在上游 Lyrico-Plugins，不在本仓库；"
            "艺术家图源源码在 artistimage-src/ 下；标签规则在 rules/ 下并按组拆分。"
        ),
        "rules": {
            "file": "rules/rules.json",
            "sha256": manifest_sha,
        },
        "bundle": {
            "url": release_base + BUNDLE_NAME,
            "sha256": bundle_sha,
            "size": len(bundle_bytes),
            # 订阅包内部这一份就是合并好的完整规则，App 直接落盘，不再逐个拉分片。
            "rules": "rules/tag_rules.json",
            "rulesSha256": merged_sha,
        },
        "plugins": plugins,
    }
    index_text = json.dumps(index, ensure_ascii=False, indent=2) + "\n"
    write_text(os.path.join(ROOT, "index.json"), index_text)
    print("index.json 已更新（%d 个插件条目）" % len(plugins))
    return index


def check() -> int:
    """校验 index.json 里公布的 sha256 与仓库里/可下载到的实际内容是否一致。"""
    index = json.loads(read_text(os.path.join(ROOT, "index.json")))
    bad = 0
    rules = index.get("rules") or {}
    path = os.path.join(ROOT, rules.get("file", "").replace("/", os.sep))
    actual = sha256_file(path)
    ok = actual == (rules.get("sha256") or "").lower()
    print(("  OK   " if ok else "  不一致 ") + "rules " + rules.get("file", "") + " " + actual)
    bad += 0 if ok else 1

    bundle = index.get("bundle") or {}
    cached = os.path.join(BUILD, BUNDLE_NAME)
    if os.path.isfile(cached):
        actual = sha256_file(cached)
        ok = actual == (bundle.get("sha256") or "").lower()
        print(("  OK   " if ok else "  不一致 ") + "bundle " + actual)
        bad += 0 if ok else 1
    else:
        print("  跳过 bundle（build/ 下还没有，先跑一次打包）")

    for item in index.get("plugins", []):
        name = os.path.basename(item.get("url", ""))
        local = os.path.join(UPSTREAM, name)
        if not os.path.isfile(local):
            local = os.path.join(RELEASE, name)
        if not os.path.isfile(local):
            print("  跳过 " + item["id"] + "（本地没有对应文件，打包时才会生成）")
            continue
        actual = sha256_file(local)
        ok = actual == (item.get("sha256") or "").lower()
        print(("  OK   " if ok else "  不一致 ") + item["id"] + " " + actual)
        bad += 0 if ok else 1
    if bad:
        print("有 %d 处对不上" % bad)
    return 1 if bad else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="打一个「一条订阅一个 zip」的订阅包")
    parser.add_argument("--tag", default=DEFAULT_TAG, help="Release 标签（默认 %s）" % DEFAULT_TAG)
    parser.add_argument("--updated-at", default="", help="index.json 里的 updatedAt（默认今天）")
    parser.add_argument("--refresh", action="store_true", help="忽略缓存，重新下载元信息源")
    parser.add_argument("--check", action="store_true", help="只校验 index.json 里的 sha256")
    args = parser.parse_args()

    if args.check:
        return check()
    updated_at = args.updated_at or datetime.date.today().isoformat()
    build(args.tag, args.refresh, updated_at)
    print("\n下一步：把 build/%s 与 4 个艺术家图源包传到 Release %s，然后提交 index.json。"
          % (BUNDLE_NAME, args.tag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
