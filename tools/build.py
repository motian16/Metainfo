#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build index.json, ArtistImages.zip and tag_rules.json.

订阅从"一个合集包"拆成三份独立资源：

    1. 元信息源：上游 Lyrico-Plugins.zip（外链，不由本仓库托管）
    2. 艺术家图源：本仓库的 artistimage/ + rules/icons/ → ArtistImages.zip
    3. 标签规则：合并 rules/ 分片 → tag_rules.json

App 更新时只下这三份（外加几 KB 的 index.json）。

Usage:
    python tools/build.py \
        --tag v1.3.0 \
        --meta-url https://github.com/Replica0110/Lyrico-Plugins/releases/download/v0.5.0/Lyrico-Plugins.zip \
        --meta-sha eed04426dced2409e0dee4b40a266ada4cbd2b6e834274fc2bcec30e2b8b58dd \
        --meta-version 0.5.0
"""

import argparse
import datetime
import hashlib
import io
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
BUNDLE_NAME = "ArtistImages.zip"
RULES_NAME = "tag_rules.json"

REPO = "motian16/Metainfo"
TAG = "v1.3.0"

META_URL = (
    "https://github.com/Replica0110/Lyrico-Plugins/releases/download/"
    "v0.5.0/Lyrico-Plugins.zip"
)
META_SHA = "eed04426dced2409e0dee4b40a266ada4cbd2b6e834274fc2bcec30e2b8b58dd"
META_VERSION = "0.5.0"

RULES_DIR = os.path.join(ROOT, "rules")
ICONS_DIR = os.path.join(RULES_DIR, "icons")
ARTIST_DIR = os.path.join(ROOT, "artistimage")

FIXED_TIME = (1980, 1, 1, 0, 0, 0)

# Rules merge layout. Must match RuleBundle in the app.
ARRAY_KEYS = ("groups", "hints")
OBJECT_KEYS = (
    "standard", "standardValues", "valueLabels", "valueLabelPatterns",
    "valueInfoPatterns", "valueAliases", "keyInfo", "sourcePriority",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def read_json(path):
    with open(path, "r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # UTF-8 without BOM: a BOM makes the app reject the whole index.json.
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def merge_rules():
    """Merge rules/rules.json and its shards into one file."""
    manifest = read_json(os.path.join(RULES_DIR, "rules.json"))
    out = {key: value for key, value in manifest.items() if key != "files"}
    for entry in manifest.get("files", []):
        relative = entry["file"]
        part = read_json(os.path.join(RULES_DIR, relative.replace("/", os.sep)))
        for key, value in part.items():
            if key in ARRAY_KEYS:
                out[key] = list(out.get(key) or []) + list(value or [])
            elif key in OBJECT_KEYS:
                merged = dict(out.get(key) or {})
                merged.update(value or {})
                out[key] = merged
            elif key not in out:
                out[key] = value
    text = json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    return text.encode("utf-8")


def collect_icons():
    icons = {}
    for name in sorted(os.listdir(ICONS_DIR)):
        if name.lower().endswith(".png"):
            icons[name] = read_bytes(os.path.join(ICONS_DIR, name))
    if not icons:
        raise SystemExit("rules/icons/ 里没有 png")
    return icons


def icons_digest(icons):
    """Aggregate icon checksum: `<name> <sha256>` per line, sorted, hashed once."""
    lines = "".join("%s %s\n" % (name, sha256(data)) for name, data in sorted(icons.items()))
    return sha256(lines.encode("utf-8"))


def artist_plugins():
    """artistimage/: one plugin per directory (manifest.json tells id/version)."""
    plugins = []
    for name in sorted(os.listdir(ARTIST_DIR)):
        directory = os.path.join(ARTIST_DIR, name)
        manifest_path = os.path.join(directory, "manifest.json")
        if not os.path.isfile(manifest_path):
            continue
        manifest = read_json(manifest_path)
        plugins.append({
            "id": manifest["id"],
            "name": manifest.get("name", manifest["id"]),
            "versionName": manifest.get("versionName", "1.0.0"),
            "root": name,
            "source": directory,
        })
    return plugins


def build_artist_zip(plugins, icons):
    """artistimage/<root>/... + icons/*.png, fixed timestamps."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        def add(path, data, store=False):
            info = zipfile.ZipInfo(path, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)

        for item in plugins:
            source_dir = item["source"]
            for folder, _, files in os.walk(source_dir):
                for name in sorted(files):
                    full = os.path.join(folder, name)
                    relative = os.path.relpath(full, source_dir).replace(os.sep, "/")
                    add("artistimage/" + item["root"] + "/" + relative, read_bytes(full))

        # Icons already compressed: store as-is. They ride with the artist zip so the
        # update stays at exactly three downloads.
        for name, data in icons.items():
            add("icons/" + name, data, store=True)
    return buffer.getvalue()


def build(release_tag, meta_url, meta_sha, meta_version):
    plugins = artist_plugins()
    rules = merge_rules()
    icons = collect_icons()

    artist_zip = build_artist_zip(plugins, icons)
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, BUNDLE_NAME), "wb") as handle:
        handle.write(artist_zip)
    with open(os.path.join(BUILD, RULES_NAME), "wb") as handle:
        handle.write(rules)

    artist_entries = [{
        "id": item["id"],
        "kind": "artistimage",
        "name": item["name"],
        "versionName": item["versionName"],
    } for item in plugins]

    index = {
        "schema": 2,
        "name": "渊の插件源",
        "updatedAt": datetime.date.today().isoformat(),
        "meta": {
            "url": meta_url,
            "sha256": meta_sha,
            "version": meta_version,
            "plugins": [
                "com.applemusic.source",
                "com.kugou.source",
                "com.lrcshare.source",
                "com.musicbrainz.source",
                "com.neteasecloudmusic.source",
                "com.qqmusic.source",
                "com.sodamusic.source",
            ],
        },
        "artistImage": {
            "url": "https://github.com/%s/releases/download/%s/%s" % (REPO, release_tag, BUNDLE_NAME),
            "sha256": sha256(artist_zip),
            "size": len(artist_zip),
            "version": "1.0.0",
        },
        "rules": {
            "url": "https://github.com/%s/releases/download/%s/%s" % (REPO, release_tag, RULES_NAME),
            "sha256": sha256(rules),
        },
        "icons": {"sha256": icons_digest(icons)},
        "plugins": artist_entries,
    }
    write_text(os.path.join(ROOT, "index.json"), json.dumps(index, ensure_ascii=False, indent=2) + "\n")

    print("ArtistImages.zip %d bytes (%.2f MB)" % (len(artist_zip), len(artist_zip) / 1048576.0))
    print("  sha256 " + index["artistImage"]["sha256"])
    print("tag_rules.json %d bytes" % len(rules))
    print("  sha256 " + index["rules"]["sha256"])
    print("icons %d png" % len(icons))
    print("index.json written")


def main():
    parser = argparse.ArgumentParser(description="Build MetaAudio subscription metadata")
    parser.add_argument("--tag", default=TAG, help="release tag of this repo (default %s)" % TAG)
    parser.add_argument("--meta-url", default=META_URL, help="Lyrico-Plugins.zip URL")
    parser.add_argument("--meta-sha", default=META_SHA, help="Lyrico-Plugins.zip sha256")
    parser.add_argument("--meta-version", default=META_VERSION, help="Lyrico-Plugins version")
    args = parser.parse_args()

    build(args.tag, args.meta_url, args.meta_sha, args.meta_version)
    return 0


if __name__ == "__main__":
    sys.exit(main())
