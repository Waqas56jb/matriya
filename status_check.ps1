Set-Location "e:\Paid Project\Fiveer\Matriya-Proj"

Write-Host "=== SERVER STATUS ==="
try {
    $h = Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "matriya-back  (8000): UP - $($h.Content.Substring(0,[Math]::Min(80,$h.Content.Length)))"
} catch { Write-Host "matriya-back  (8000): DOWN - $($_.Exception.Message)" }

try {
    $h2 = Invoke-WebRequest -Uri "http://localhost:8001/api/lab/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "managment-back (8001): UP - $($h2.Content)"
} catch { Write-Host "managment-back (8001): DOWN - $($_.Exception.Message)" }

Write-Host ""
Write-Host "=== GIT STATUS ==="
git log --oneline -5 2>&1
git status --short 2>&1

Write-Host ""
Write-Host "=== MATRIYA-BACK UNSTAGED DIFF (key lines) ==="
git diff HEAD -- matriya-back/server.js 2>&1 | Where-Object { $_ -match "^\+" -or $_ -match "^\-" } | Select-Object -First 30
