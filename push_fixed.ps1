Set-Location "e:\Paid Project\Fiveer\Matriya-Proj"

# Fix the problematic postBuffer - set to something reasonable, not 500MB
git config http.postBuffer 52428800 2>&1   # 50MB, not 500MB
git config pack.window 0   2>&1
git config pack.depth  0   2>&1

Write-Host "=== GIT CONFIG (http.postBuffer, pack.window, pack.depth) ==="
git config --list 2>&1 | Where-Object { $_ -match "postBuffer|pack\.(window|depth|window|compression)" }

Write-Host ""
Write-Host "=== GIT LOG (2 commits to push) ==="
git log origin/main..HEAD --oneline 2>&1

Write-Host ""
Write-Host "=== PUSH ==="
git push origin main 2>&1
Write-Host "Push exit: $LASTEXITCODE"
