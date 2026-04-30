Set-Location "e:\Paid Project\Fiveer\Matriya-Proj"

Write-Host "=== MANAGMENT-BACK UNSTAGED DIFF ==="
git diff HEAD -- managment-back/server.js 2>&1 | Where-Object { $_ -match "^\+|^\-" } | Select-Object -First 40

Write-Host ""
Write-Host "=== WHAT IS IN 1840d0d (the committed fix) ==="
git show 1840d0d --stat 2>&1
git show 1840d0d -- managment-back/server.js 2>&1 | Where-Object { $_ -match "^\+|^\-" } | Select-Object -First 20
