#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check a published subscription: index.json -> bundle -> every file inside.

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
BUNDLE_NAME = "MetaAudio-Subscription.zip"

problems = []


def check(ok, label, extra=""):
    print(("  ok    " if ok else "  FAIL  ") + label + (("  " + extra) if extra else ""))
    if not ok:
        problems.append(label)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Metainfo-Verify"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return response.read()


def digests(data):
    return hashlib.md5(data).hexdigest(), hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true", help="verify local index.json + build/")
    args = parser.parse_args()

    if args.local:
        with open(os.path.join(ROOT, "index.json"), "r", encoding="utf-8-sig") as handle:
            index = json.load(handle)
        bundle = open(os.path.join(ROOT, "build", BUNDLE_NAME), "rb").read()
        print("local index.json + build/" + BUNDLE_NAME)
    else:
        print("GET " + INDEX_URL)
        index = json.loads(fetch(INDEX_URL).decode("utf-8"))
        bundle_meta = index["bundle"]
        print("GET " + bundle_meta["url"])
        bundle = fetch(bundle_meta["url"])

    meta = index["bundle"]
    md5, sha = digests(bundle)
    check(md5 == meta.get("md5", "").lower(), "bundle md5", md5)
    check(sha == meta.get("sha256", "").lower(), "bundle sha256", sha)
    check(len(bundle) == meta.get("size", len(bundle)), "bundle size", str(len(bundle)))

    archive = zipfile.ZipFile(io.BytesIO(bundle))
    names = set(archive.namelist())
    rules = archive.read("rules/tag_rules.json")
    check(hashlib.sha256(rules).hexdigest() == meta.get("rulesSha256", "").lower(),
          "rules sha256", str(json.loads(rules).get("rulesVersion")) + " 版")

    for item in index["plugins"]:
        entry = "plugins/" + item["id"] + ".zip"
        if entry not in names:
            check(False, item["id"] + " in bundle")
            continue
        raw = archive.read(entry)
        with zipfile.ZipFile(io.BytesIO(raw)) as plugin:
            manifest_name = next((n for n in plugin.namelist() if n.endswith("manifest.json")), None)
            if manifest_name is None:
                check(False, item["id"] + " manifest.json")
                continue
            manifest = json.loads(plugin.read(manifest_name).decode("utf-8-sig"))
        check(manifest.get("id") == item["id"], item["id"] + " id")
        check(manifest.get("versionName") == item["versionName"],
              item["id"] + " version", str(manifest.get("versionName")))

    icons = [n for n in names if n.startswith("icons/") and n.lower().endswith(".png")]
    check(len(icons) > 0, "icons in bundle", str(len(icons)) + " png")
    lines = ""
    for path in sorted(icons):
        data = archive.read(path)
        lines += "%s %s\n" % (path.split("/")[-1], hashlib.sha256(data).hexdigest())
    aggregate = hashlib.sha256(lines.encode("utf-8")).hexdigest()
    check(aggregate == (index.get("icons") or {}).get("sha256", "").lower(), "icons sha256")

    print()
    if problems:
        print("%d problem(s)" % len(problems))
        return 1
    print("all good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
