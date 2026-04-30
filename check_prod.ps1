# Check if production managment-back has the min_phr fix deployed
Write-Host "=== PRODUCTION managment-back project-materials ==="
try {
    $r = Invoke-WebRequest -Uri "https://steadfast-success-production-02d1.up.railway.app/api/matriya/project-materials?project_id=aaaaaaaa-0001-0001-0001-000000000001" `
        -Headers @{ "x-matriya-materials-key" = "shared_secret_matches_matriya_back" } `
        -UseBasicParsing -TimeoutSec 15
    Write-Host "STATUS: $($r.StatusCode) - DEPLOYED!"
    Write-Host "CONTENT: $($r.Content)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    try { Write-Host "BODY: $([System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream()).ReadToEnd())" } catch {}
}

Write-Host ""
Write-Host "=== LOCAL managment-back project-materials ==="
try {
    $r2 = Invoke-WebRequest -Uri "http://localhost:8001/api/matriya/project-materials?project_id=aaaaaaaa-0001-0001-0001-000000000001" `
        -Headers @{ "x-matriya-materials-key" = "shared_secret_matches_matriya_back" } `
        -UseBasicParsing -TimeoutSec 10
    Write-Host "STATUS: $($r2.StatusCode)"
    Write-Host "CONTENT: $($r2.Content)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "=== INCOMPLETE project materials ==="
try {
    $r3 = Invoke-WebRequest -Uri "http://localhost:8001/api/matriya/project-materials?project_id=bbbbbbbb-0002-0002-0002-000000000002" `
        -Headers @{ "x-matriya-materials-key" = "shared_secret_matches_matriya_back" } `
        -UseBasicParsing -TimeoutSec 10
    Write-Host "STATUS: $($r3.StatusCode)"
    Write-Host "CONTENT: $($r3.Content)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
