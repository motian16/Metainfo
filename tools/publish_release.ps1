# Publish a release: uploads build/MetaAudio-Subscription.zip plus the four
# artist-image plugin zips from build/release/.
#
# Usage:  $env:GH_TOKEN='<token>'; .\tools\publish_release.ps1 -Tag v4
# Before: python tools/build_bundle.py   (it refreshes the sha256 in index.json)
#
# This file is deliberately ASCII-only: a .ps1 with non-ASCII comments is read
# with the wrong encoding by Windows PowerShell and fails to parse.
param(
    [string]$Tag = "v3",
    [string]$Repo = "motian16/Metainfo"
)
$ErrorActionPreference = "Stop"
$token = $env:GH_TOKEN
if (-not $token) { throw "GH_TOKEN is not set" }
$headers = @{ Authorization = "token $token"; "User-Agent" = "MetaAudio-Repo-Builder" }
$root = Split-Path -Parent $PSScriptRoot

$rulesVersion = (Get-Content "$root\rules\rules.json" -Raw -Encoding UTF8 | ConvertFrom-Json).rulesVersion
$assets = @("$root\build\MetaAudio-Subscription.zip")
$assets += Get-ChildItem "$root\build\release\*.zip" | ForEach-Object { $_.FullName }

$body = @{
    tag_name         = $Tag
    target_commitish = "main"
    # Title and notes stay ASCII (requested): no Chinese on the release page.
    # The notes live in tools/release-notes.md so wording changes need no code edit.
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
    Write-Output ("  " + $uploaded.name + "  " + $uploaded.size + " bytes (local " + $size + ")  " + $uploaded.browser_download_url)
}
