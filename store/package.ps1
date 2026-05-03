# Build & Package Script for Chrome Web Store

# Run from the repo root:
#   .\store\package.ps1

$ErrorActionPreference = "Stop"

$version  = (Get-Content manifest.json | ConvertFrom-Json).version
$outFile  = "store\upwrite-v$version.zip"

# Files/folders to EXCLUDE from the zip
$exclude = @(
  ".git",
  ".gitignore",
  ".env",
  "node_modules",
  "store",
  "*.zip",
  "DOCUMENTATION.md"
)

Write-Host "Packaging UpWrite v$version..." -ForegroundColor Cyan

# Build the list of items to include
$items = Get-ChildItem -Path . -Force |
  Where-Object { $_.Name -notin $exclude }

# Remove old zip if it exists
if (Test-Path $outFile) { Remove-Item $outFile -Force }

# Compress
Compress-Archive -Path ($items.FullName) -DestinationPath $outFile -CompressionLevel Optimal

$size = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
Write-Host "Done!  $outFile  ($size KB)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Go to https://chrome.google.com/webstore/devconsole"
Write-Host "  2. Click 'New item' and upload $outFile"
