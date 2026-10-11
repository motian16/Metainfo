# -*- coding: utf-8 -*-
"""量一批 GitHub 中转前缀：raw 文件与 Release 资产各走得通吗、快不快。

镜像站是会关的（`ghproxy.cn` 现在就只会回它自己的一张网页，`gh.ddlc.top` 限流），
所以 App 里那张默认镜像表要定期这样量一遍。跑法：

    python tools/probe_mirrors.py              # 用内置的候选表
    python tools/probe_mirrors.py https://a/ https://b/

输出里 `包:` 那一列才是关键 —— 现在的「更新订阅」第一步是去 Release 拿订阅包，
jsDelivr 服务不了 Release，只能靠这些中转。
"""
import hashlib
import json
import sys
import time
import urllib.request

CANDIDATES = [
    "https://gh-proxy.com/",
    "https://ghfast.top/",
    "https://hk.gh-proxy.com/",
    "https://gh.llkk.cc/",
    "https://cdn.gh-proxy.com/",
    "https://ghproxy.net/",
    "https://ghproxy.cn/",
    "https://gh.ddlc.top/",
    "https://hub.gitmirror.com/",
    "https://ghproxy.cc/",
    "https://ghp.ci/",
    "https://github.moeyy.xyz/",
]


def get(url, timeout=30):
    request = urllib.request.Request(url, headers={"User-Agent": "MetaAudio-Probe"})
    started = time.time()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read()
    return data, time.time() - started


def probe(prefix, target, expect_sha=None):
    try:
        data, millis = get(prefix + target)
    except Exception as error:
        return "不通（" + str(error)[:44] + "）"
    if expect_sha and hashlib.sha256(data).hexdigest() != expect_sha:
        # 拿到的是内容不对的一份：多半是中转站自己的网页（ghproxy.cn 就是这样）。
        return "内容不对（%d 字节，%.1fs）" % (len(data), millis)
    return "OK  %7d 字节  %4.1fs" % (len(data), millis)


def main():
    raw_index = "https://raw.githubusercontent.com/motian16/Metainfo/main/index.json"
    index = json.loads(get(raw_index)[0])
    bundle = index["bundle"]["url"]
    bundle_sha = index["bundle"]["sha256"]
    # 小文件（index.json 本身）先探，通了再探订阅包（那才是真正要用的大文件）。
    prefixes = sys.argv[1:] or CANDIDATES
    for prefix in prefixes:
        quick = probe(prefix, raw_index)
        heavy = probe(prefix, bundle, bundle_sha) if not quick.startswith("不通") else "跳过"
        print("%-28s raw: %-32s 包: %s" % (prefix, quick, heavy))


if __name__ == "__main__":
    main()
