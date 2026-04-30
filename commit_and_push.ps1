Set-Location "e:\Paid Project\Fiveer\Matriya-Proj"

# Stage matriya-back server.js (the uncaughtException + min_phr removal)
git add matriya-back/server.js 2>&1

Write-Host "=== STAGED FILES ==="
git diff --cached --stat 2>&1

# Commit
git commit -m "fix: add uncaughtException handler for pg drops + remove min_phr from material format string" 2>&1
Write-Host "Commit exit: $LASTEXITCODE"

Write-Host ""
Write-Host "=== GIT LOG (last 3) ==="
git log --oneline -3 2>&1

# Push with --no-thin to avoid malloc issues with large pack objects
Write-Host ""
Write-Host "=== PUSHING (--no-thin) ==="
git config http.postBuffer 524288000 2>&1
git push --no-thin origin main 2>&1
Write-Host "Push exit: $LASTEXITCODE"
