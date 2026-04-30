# Test the STOP gate and inspect 404 error
Write-Host "=== Testing /api/research/run endpoint ==="

$body = @{
    query        = "propose a formulation"
    session_id   = "test-stop-001"
    project_mode = $true
} | ConvertTo-Json

Write-Host "Body: $body"
Write-Host ""

try {
    $resp = Invoke-WebRequest -Uri "http://localhost:8000/api/research/run" `
        -Method POST -Body $body -ContentType "application/json" `
        -UseBasicParsing -TimeoutSec 30
    Write-Host "STATUS: $($resp.StatusCode)"
    Write-Host "CONTENT: $($resp.Content)"
} catch {
    Write-Host "HTTP ERROR: $($_.Exception.Message)"
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $errBody = $reader.ReadToEnd()
        Write-Host "ERROR BODY: $errBody"
        Write-Host "STATUS CODE: $($_.Exception.Response.StatusCode)"
    } catch {
        Write-Host "Could not read error body: $($_.Exception.Message)"
    }
}

Write-Host ""
Write-Host "=== Quick health check ==="
$h = (Invoke-WebRequest -Uri "http://localhost:8000/health" -UseBasicParsing -TimeoutSec 5).Content
Write-Host $h
