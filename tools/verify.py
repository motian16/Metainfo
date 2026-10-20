#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check a published subscription: index.json -> meta / artistImage / rules.

    python tools/verify.py            # against the published index.json
    python tools/verify.py --local    # against the local index.json + build/
"""

import argparse
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INDEX_URL = "https://raw.githubusercontent.com/motian16/Metainfo/main/index.json"
ARTIST_NAME = "ArtistImages.zip"
RULES_NAME = "tag_rules.json"

problems = []


def check(ok, label, extra=""):
    print(("  ok    " if ok else "  FAIL  ") + label + (("  " + extra) if extra else ""))
    if not ok:
        problems.append(label)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Metainfo-Verify"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="verify local index.json + build/")
    args = parser.parse_args()

    if args.local:
        with open(os.path.join(ROOT, "index.json"), "r", encoding="utf-8-sig") as handle:
            index = json.load(handle)
        artist = open(os.path.join(ROOT, "build", ARTIST_NAME), "rb").read()
        rules = open(os.path.join(ROOT, "build", RULES_NAME), "rb").read()
        meta = open(os.path.join(ROOT, "build", "Lyrico-Plugins.cached.zip"), "rb").read() \
            if os.path.isfile(os.path.join(ROOT, "build", "Lyrico-Plugins.cached.zip")) else None
        print("local index.json + build/")
    else:
        print("GET " + INDEX_URL)
        index = json.loads(fetch(INDEX_URL).decode("utf-8"))
        print("GET index.meta.url")
        meta = fetch(index["meta"]["url"])
        print("GET index.artistImage.url")
        artist = fetch(index["artistImage"]["url"])
        print("GET index.rules.url")
        rules = fetch(index["rules"]["url"])

    if meta is not None:
        check(sha256(meta) == index["meta"].get("sha256", "").lower(), "meta sha256")
        with zipfile.ZipFile(io.BytesIO(meta)) as archive:
            manifests = [n for n in archive.namelist() if n.endswith("/manifest.json")]
        check(len(manifests) > 0, "meta plugins", str(len(manifests)) + " 个")

    check(sha256(artist) == index["artistImage"].get("sha256", "").lower(), "artistImage sha256")
    check(len(artist) == index["artistImage"].get("size", len(artist)),
          "artistImage size", str(len(artist)))

    archive = zipfile.ZipFile(io.BytesIO(artist))
    names = set(archive.namelist())
    found = {}
    for name in names:
        if not name.endswith("/manifest.json"):
            continue
        manifest = json.loads(archive.read(name).decode("utf-8-sig"))
        found[manifest.get("id")] = manifest
    for item in index["plugins"]:
        manifest = found.get(item["id"])
        check(manifest is not None, item["id"] + " in artist zip")
        if manifest is not None:
            check(manifest.get("versionName") == item["versionName"],
                  item["id"] + " version", str(manifest.get("versionName")))

    icons = [n for n in names if n.startswith("icons/") and n.lower().endswith(".png")]
    check(len(icons) > 0, "icons in artist zip", str(len(icons)) + " png")
    lines = ""
    for path in sorted(icons):
        lines += "%s %s\n" % (path.split("/")[-1], sha256(archive.read(path)))
    check(sha256(lines.encode("utf-8")) == (index.get("icons") or {}).get("sha256", "").lower(),
          "icons sha256")

    check(sha256(rules) == index["rules"].get("sha256", "").lower(), "rules sha256")
    check(json.loads(rules.decode("utf-8")).get("rulesVersion") is not None, "rules parsed")

    print()
    if problems:
        print("%d problem(s)" % len(problems))
        return 1
    print("all good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
