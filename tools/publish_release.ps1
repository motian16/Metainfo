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
    # 标题与说明都保持 ASCII（用户要求）：Release 页面上不出现中文。
    # 说明正文放 tools/release-notes.md，改文案不用动脚本。
    name             = "$Tag - MetaAudio subscription bundle"
    body             = (Get-Content "$PSScriptRoot\release-notes.md" -Raw -Encoding UTF8).
                           Replace("{rulesVersion}", "$rulesVersion")
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
