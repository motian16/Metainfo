# 发布 Release：把 build/ 里的订阅包与 4 个图源包传上去。
# 用法：$env:GH_TOKEN='<token>'; .\tools\publish_release.ps1 -Tag v2
# 前置：先跑 python tools/build_bundle.py（它会更新 index.json 里的 sha256）。
param(
    [string]$Tag = "v2",
    [string]$Repo = "motian16/Metainfo"
)
$ErrorActionPreference = "Stop"
$token = $env:GH_TOKEN
if (-not $token) { throw "缺少 GH_TOKEN" }
$headers = @{ Authorization = "token $token"; "User-Agent" = "MetaAudio-Repo-Builder" }
$root = Split-Path -Parent $PSScriptRoot

$index = Get-Content "$root\index.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$rulesVersion = (Get-Content "$root\rules\rules.json" -Raw -Encoding UTF8 | ConvertFrom-Json).rulesVersion
$assets = @("$root\build\MetaAudio-Subscription.zip")
$assets += Get-ChildItem "$root\build\release\*.zip" | ForEach-Object { $_.FullName }

$body = @{
    tag_name         = $Tag
    target_commitish = "main"
    name             = "$Tag 一条订阅一个包"
    body             = @"
MetaAudio 订阅源的发行版资产。

**MetaAudio-Subscription.zip** —— App 点「更新订阅」时下载的**唯一**一个包，内含：

- 元信息源（上游 Lyrico-Plugins 的发布包）：QQ音乐 0.4.2 / 网易云音乐 0.4.1 / Apple Music 0.4.1 / 酷狗音乐 0.4.1 / MusicBrainz 1.2.1
- 艺术家图源（本仓库 artistimage-src/）：com.metaaudio.artistimage.qq / netease / apple / kugou
- 标签识别规则（合并好的完整一份，rulesVersion $rulesVersion）

包内结构：``plugins/<包名>.zip`` + ``rules/tag_rules.json``。
订阅的 index.json 里公布了这个包的 sha256（整包校验）与包内规则的 sha256。

其余 4 个 zip 是各个艺术家图源的**单独包**：订阅包取不到时 App 会退回逐个下载它们。

订阅地址：``https://raw.githubusercontent.com/motian16/Metainfo/main/index.json``
"@
    draft            = $false
    prerelease       = $false
}

$release = Invoke-RestMethod -Headers $headers -Method Post `
    -Uri "https://api.github.com/repos/$Repo/releases" `
    -ContentType "application/json; charset=utf-8" `
    -Body ([System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $body -Depth 5)))

Write-Output ("release " + $release.tag_name + " -> " + $release.html_url)
foreach ($file in $assets) {
    $name = [System.IO.Path]::GetFileName($file)
    $size = (Get-Item $file).Length
    $uploaded = Invoke-RestMethod -Headers $headers -Method Post `
        -Uri ("https://uploads.github.com/repos/$Repo/releases/" + $release.id + "/assets?name=" + [uri]::EscapeDataString($name)) `
        -ContentType "application/zip" -InFile $file
    Write-Output ("  " + $uploaded.name + "  " + $uploaded.size + " 字节（本地 " + $size + "）  " + $uploaded.browser_download_url)
}
