Set-Location "e:\Paid Project\Fiveer\Matriya-Proj"

# Check if gh CLI is available
Write-Host "=== GH CLI CHECK ==="
gh --version 2>&1 | Select-Object -First 2

Write-Host ""
Write-Host "=== AGGRESSIVE PACK MEMORY SETTINGS ==="
git config pack.window 0        2>&1
git config pack.depth  0        2>&1
git config pack.windowMemory 1m 2>&1
git config pack.deltaCacheSize 1m 2>&1
git config pack.compression 0  2>&1
git config core.compression 0  2>&1
git config http.postBuffer 524288000 2>&1

Write-Host "Settings applied."

Write-Host ""
Write-Host "=== GIT FSK CHECK ==="
git fsck --no-dangling 2>&1 | Select-Object -First 10

Write-Host ""
Write-Host "=== PUSH ATTEMPT ==="
git push origin main 2>&1
Write-Host "Push exit: $LASTEXITCODE"
