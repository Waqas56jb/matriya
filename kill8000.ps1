Write-Host "=== All processes on port 8000 ==="
$connections = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    $mpid = $conn.OwningProcess
    $proc = Get-Process -Id $mpid -ErrorAction SilentlyContinue
    Write-Host "PID: $mpid | Name: $($proc.Name) | Path: $($proc.Path)"
    Stop-Process -Id $mpid -Force -ErrorAction SilentlyContinue
    Write-Host "Killed PID $mpid"
}

Start-Sleep -Seconds 2
$check = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($check) { Write-Host "STILL IN USE!" } else { Write-Host "Port 8000 is FREE" }
