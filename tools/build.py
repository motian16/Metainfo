#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build index.json and the subscription bundle.

The bundle is the single zip the app downloads when updating its subscription:

    plugins/<plugin id>.zip   meta sources (upstream Lyrico-Plugins) + artist images (this repo)
    rules/tag_rules.json      merged tag rules
    icons/*.png               platform icons for the meta page

Usage:
    python tools/build.py                      # latest upstream release, default tag
    python tools/build.py --tag v1.2.0
    python tools/build.py --upstream-tag v0.4.0 --refresh
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
PLUGIN_OUT = os.path.join(BUILD, "plugins")
BUNDLE_NAME = "MetaAudio-Subscription.zip"

REPO = "motian16/Metainfo"
TAG = "v1.2.0"

UPSTREAM_REPO = "Replica0110/Lyrico-Plugins"
UPSTREAM_BUNDLE = "Lyrico-Plugins.zip"
UPSTREAM_MANIFEST = "release-manifest.json"

RULES_DIR = os.path.join(ROOT, "rules")
ICONS_DIR = os.path.join(RULES_DIR, "icons")
ARTIST_DIR = os.path.join(ROOT, "artistimage")

FIXED_TIME = (1980, 1, 1, 0, 0, 0)

# Rules merge layout. Must match RuleBundle in the app.
ARRAY_KEYS = ("groups", "hints")
OBJECT_KEYS = (
    "standard", "standardValues", "valueLabels", "valueLabelPatterns",
    "valueInfoPatterns", "valueAliases", "keyInfo",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def md5(data):
    return hashlib.md5(data).hexdigest()


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


def http_get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Metainfo-Build"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def latest_upstream_tag():
    url = "https://api.github.com/repos/%s/releases/latest" % UPSTREAM_REPO
    return json.loads(http_get(url).decode("utf-8"))["tag_name"]


def fetch_upstream_asset(tag, name, refresh):
    path = os.path.join(UPSTREAM, tag, name)
    if os.path.isfile(path) and not refresh:
        return read_bytes(path)
    url = "https://github.com/%s/releases/download/%s/%s" % (UPSTREAM_REPO, tag, name)
    data = http_get(url)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    return data


def extract_upstream_sources(tag, bundle_bytes):
    """Unpack Lyrico-Plugins.zip; returns {root: source dir}."""
    out = os.path.join(UPSTREAM, tag, "src")
    if os.path.isdir(out):
        import shutil
        shutil.rmtree(out)
    roots = {}
    with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as archive:
        for entry in archive.namelist():
            if entry.endswith("/"):
                continue
            parts = entry.split("/")
            # Layout: Lyrico-Plugins/<root>/<file...>
            if len(parts) < 3 or parts[0] != "Lyrico-Plugins":
                continue
            relative = "/".join(parts[1:])
            target = os.path.join(out, relative.replace("/", os.sep))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, "wb") as handle:
                handle.write(archive.read(entry))
            roots[parts[1]] = os.path.join(out, parts[1])
    return roots


def zip_tree(source_dir, prefix):
    """Zip one plugin source directory (single top-level dir, fixed timestamps)."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for folder, _, files in os.walk(source_dir):
            for name in sorted(files):
                full = os.path.join(folder, name)
                relative = os.path.relpath(full, source_dir).replace(os.sep, "/")
                info = zipfile.ZipInfo(prefix + "/" + relative, date_time=FIXED_TIME)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                archive.writestr(info, read_bytes(full))
    return buffer.getvalue()


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
    """Log in artistimage/: one plugin per directory (manifest.json tells id/version)."""
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


def build(release_tag, upstream_tag, refresh):
    tag = upstream_tag or latest_upstream_tag()
    print("upstream %s/%s" % (UPSTREAM_REPO, tag))
    bundle_bytes = fetch_upstream_asset(tag, UPSTREAM_BUNDLE, refresh)
    manifest = json.loads(fetch_upstream_asset(tag, UPSTREAM_MANIFEST, refresh).decode("utf-8"))
    roots = extract_upstream_sources(tag, bundle_bytes)

    plugin_files = []
    meta_entries = []
    for item in manifest["plugins"]:
        source = roots.get(item["root"])
        if source is None:
            raise SystemExit("上游包里没有目录：" + item["root"])
        data = zip_tree(source, item["root"])
        plugin_files.append((item["id"] + ".zip", data))
        meta_entries.append({
            "id": item["id"],
            "kind": "meta",
            "name": item["name"],
            "versionName": item["versionName"],
        })
        print("  meta   %-28s %-9s %7d bytes" % (item["id"], item["versionName"], len(data)))

    artist_entries = []
    for item in artist_plugins():
        data = zip_tree(item["source"], item["root"])
        plugin_files.append((item["id"] + ".zip", data))
        artist_entries.append({
            "id": item["id"],
            "kind": "artistimage",
            "name": item["name"],
            "versionName": item["versionName"],
        })
        print("  artist %-28s %-9s %7d bytes" % (item["id"], item["versionName"], len(data)))

    rules = merge_rules()
    icons = collect_icons()
    print("  rules  rulesVersion=%s  %d bytes" % (json.loads(rules).get("rulesVersion"), len(rules)))
    print("  icons  %d png" % len(icons))

    os.makedirs(PLUGIN_OUT, exist_ok=True)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        def add(path, data, store=False):
            info = zipfile.ZipInfo(path, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)

        # Plugin zips and pngs are already compressed; re-compressing only burns time.
        for name, data in plugin_files:
            with open(os.path.join(PLUGIN_OUT, name), "wb") as handle:
                handle.write(data)
            add("plugins/" + name, data, store=True)
        for name, data in icons.items():
            add("icons/" + name, data, store=True)
        add("rules/tag_rules.json", rules)

    bundle = buffer.getvalue()
    with open(os.path.join(BUILD, BUNDLE_NAME), "wb") as handle:
        handle.write(bundle)

    index = {
        "schema": 1,
        "name": "渊の插件源",
        "updatedAt": datetime.date.today().isoformat(),
        "bundle": {
            "url": "https://github.com/%s/releases/download/%s/%s" % (REPO, release_tag, BUNDLE_NAME),
            "md5": md5(bundle),
            "sha256": sha256(bundle),
            "size": len(bundle),
            "rules": "rules/tag_rules.json",
            "rulesSha256": sha256(rules),
        },
        "icons": {"sha256": icons_digest(icons)},
        "plugins": meta_entries + artist_entries,
    }
    write_text(os.path.join(ROOT, "index.json"), json.dumps(index, ensure_ascii=False, indent=2) + "\n")

    print("bundle %d bytes (%.2f MB)" % (len(bundle), len(bundle) / 1048576.0))
    print("  md5    " + index["bundle"]["md5"])
    print("  sha256 " + index["bundle"]["sha256"])
    print("index.json written")


def main():
    parser = argparse.ArgumentParser(description="Build the MetaAudio subscription bundle")
    parser.add_argument("--tag", default=TAG, help="release tag of this repo (default %s)" % TAG)
    parser.add_argument("--upstream-tag", default="", help="Lyrico-Plugins tag (default: latest)")
    parser.add_argument("--refresh", action="store_true", help="re-download the upstream zip")
    args = parser.parse_args()

    build(args.tag, args.upstream_tag, args.refresh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
