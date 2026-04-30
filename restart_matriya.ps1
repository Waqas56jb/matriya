# Kill existing matriya-back on port 8000 (avoid $pid reserved word, use $mpid)
Write-Host "=== Killing existing matriya-back (port 8000) ==="
$ownerPids = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($mpid in $ownerPids) {
    if ($mpid -gt 0) {
        Write-Host "Killing PID $mpid"
        Stop-Process -Id $mpid -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 3

$check = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($check) { Write-Host "WARNING: port 8000 still in use" } else { Write-Host "Port 8000 is free - ready for restart" }
