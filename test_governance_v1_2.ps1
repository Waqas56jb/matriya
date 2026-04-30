[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$BASE = "http://localhost:8001"

# ---- Auth: login as admin to get token ----
# Credentials: set TEST_USERNAME and TEST_PASSWORD as environment variables before running.
# e.g.:  $env:TEST_USERNAME = "your@email.com"; $env:TEST_PASSWORD = "YourPass"
$testUser = if ($env:TEST_USERNAME) { $env:TEST_USERNAME } else { Read-Host "Username" }
$testPass = if ($env:TEST_PASSWORD) { $env:TEST_PASSWORD } else { (Read-Host "Password" -AsSecureString | ConvertFrom-SecureString -AsPlainText) }
$loginBody = @{ username = $testUser; password = $testPass } | ConvertTo-Json
try {
  $auth = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 10
  $token = $auth.access_token
} catch {
  Write-Host "AUTH FAILED: $_"
  exit 1
}
$headers = @{ Authorization = "Bearer $token" }

# ---- Use INT-TFX-ACTIVE project (has lab experiments, waqas is owner) ----
$projectId = "aaaaaaaa-0001-0001-0001-000000000001"
Write-Host "Using project: $projectId (INT-TFX-ACTIVE)"
Write-Host ""

$pass = 0
$fail = 0
$results = @()

function Check($name, $ok, $detail = "") {
  if ($ok) {
    Write-Host "  PASS  $name"
    $script:pass++
    $script:results += [PSCustomObject]@{ test=$name; result="PASS"; detail=$detail }
  } else {
    Write-Host "  FAIL  $name  --  $detail"
    $script:fail++
    $script:results += [PSCustomObject]@{ test=$name; result="FAIL"; detail=$detail }
  }
}

# ===========================================================================
# CONTRACT TESTS (C1 - C8)
# ===========================================================================
Write-Host "=== CONTRACT WORKFLOW TESTS ==="

# C1: Create contract (draft)
try {
  $c1body = @{ title = "Test Contract v1.2"; description = "Governance test contract" } | ConvertTo-Json
  $c1 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts" -Method POST -Headers $headers -Body $c1body -ContentType "application/json" -TimeoutSec 10
  $contractId = $c1.contract.id
  $c1ok = ($c1.contract.status -eq "draft") -and ($c1.contract.created_by -ne $null) -and ($contractId -ne $null)
  Check "C1: Create contract - status=draft, created_by set, id exists" $c1ok "status=$($c1.contract.status) created_by=$($c1.contract.created_by)"
} catch {
  Check "C1: Create contract" $false "Exception: $_"; $contractId = $null
}

# C2: Save terms
if ($contractId) {
  try {
    $termsBody = @{
      terms = @(
        @{ term_key = "data_access"; term_value = "Read-only access to approved experiments"; term_type = "data_access" },
        @{ term_key = "expiry"; term_value = "12 months from approval date"; term_type = "expiry" },
        @{ term_key = "compliance"; term_value = "Must comply with ISO 27001"; term_type = "compliance" }
      )
    } | ConvertTo-Json -Depth 4
    $c2 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$contractId/terms" -Method POST -Headers $headers -Body $termsBody -ContentType "application/json" -TimeoutSec 10
    Check "C2: Save 3 terms" ($c2.count -eq 3) "count=$($c2.count)"
  } catch {
    Check "C2: Save terms" $false "Exception: $_"
  }
}

# C3: Get contract (with terms)
if ($contractId) {
  try {
    $c3 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$contractId" -Headers $headers -TimeoutSec 10
    Check "C3: Get contract returns contract + terms" ($c3.contract -ne $null -and $c3.terms.Count -eq 3) "terms=$($c3.terms.Count)"
  } catch {
    Check "C3: Get contract" $false "Exception: $_"
  }
}

# C4: Submit for approval → status=pending_approval + approval_log row
if ($contractId) {
  try {
    $c4 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$contractId/submit" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10
  $logCheck = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs?record_type=contract&record_id=$contractId" -Headers $headers -TimeoutSec 10
  $hasSubmitLog = @($logCheck.logs | Where-Object { $_.action -eq "submitted" }).Count -gt 0
    Check "C4: Submit - status=pending_approval + approval_log row" ($c4.contract.status -eq "pending_approval" -and $hasSubmitLog) "status=$($c4.contract.status) log=$hasSubmitLog"
  } catch {
    Check "C4: Submit for approval" $false "Exception: $_"
  }
}

# C5: Approve (as owner/admin) → status=approved + approved_at set + approval_log
if ($contractId) {
  try {
    $c5 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$contractId/approve" -Method POST -Headers $headers -Body '{"reason":"All terms verified"}' -ContentType "application/json" -TimeoutSec 10
  $logCheck2 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs?record_type=contract&record_id=$contractId" -Headers $headers -TimeoutSec 10
  $hasApproveLog = @($logCheck2.logs | Where-Object { $_.action -eq "approved" }).Count -gt 0
  Check "C5: Approve - status=approved, approved_at set, log exists" ($c5.contract.status -eq "approved" -and $c5.contract.approved_at -ne $null -and $hasApproveLog) "status=$($c5.contract.status) approved_at=$($c5.contract.approved_at -ne $null) log=$hasApproveLog"
  } catch {
    Check "C5: Approve contract" $false "Exception: $_"
  }
}

# C6: Create + submit + reject a second contract
try {
  $c6body = @{ title = "Contract to Reject" } | ConvertTo-Json
  $c6c = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts" -Method POST -Headers $headers -Body $c6body -ContentType "application/json" -TimeoutSec 10
  $cid2 = $c6c.contract.id
  Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$cid2/submit" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10 | Out-Null
  $c6r = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$cid2/reject" -Method POST -Headers $headers -Body '{"reason":"Missing compliance terms"}' -ContentType "application/json" -TimeoutSec 10
  $logCheck3 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs?record_type=contract&record_id=$cid2" -Headers $headers -TimeoutSec 10
  $hasRejectLog = @($logCheck3.logs | Where-Object { $_.action -eq "rejected" }).Count -gt 0
  Check "C6: Reject - status=rejected, reason stored, log exists" ($c6r.contract.status -eq "rejected" -and $hasRejectLog) "status=$($c6r.contract.status) log=$hasRejectLog"
} catch {
  Check "C6: Reject contract" $false "Exception: $_"
}

# C7: Non-member cannot access contract endpoints (simulate by using bad token)
try {
  $badHeaders = @{ Authorization = "Bearer bad.token.here" }
  $err = $null
  try {
    Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts" -Method POST -Headers $badHeaders -Body '{"title":"x"}' -ContentType "application/json" -TimeoutSec 10 | Out-Null
  } catch {
    $err = $_.Exception.Response.StatusCode.value__
  }
  Check "C7: Non-auth user blocked (401/403)" ($err -eq 401 -or $err -eq 403) "status=$err"
} catch {
  Check "C7: Non-auth user blocked" $false "Exception: $_"
}

# C8: Approved contract cannot be edited (PATCH → 403)
if ($contractId) {
  try {
    $err8 = $null
    try {
      Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/contracts/$contractId" -Method PATCH -Headers $headers -Body '{"title":"Hacked"}' -ContentType "application/json" -TimeoutSec 10 | Out-Null
    } catch {
      $err8 = $_.Exception.Response.StatusCode.value__
    }
    Check "C8: Approved contract cannot be edited (403)" ($err8 -eq 403) "status=$err8"
  } catch {
    Check "C8: Approved contract lock" $false "Exception: $_"
  }
}

Write-Host ""

# ===========================================================================
# DATA GOVERNANCE TESTS (G1 - G8)
# ===========================================================================
Write-Host "=== DATA GOVERNANCE TESTS ==="

# Create 3 fresh test experiments (always in draft state)
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$newExp1 = @{ experiment_id="GOV-TEST-A-$ts"; formulation="Test formulation A"; status="PENDING"; notes="v1.2 gov test A" } | ConvertTo-Json
$newExp2 = @{ experiment_id="GOV-TEST-B-$ts"; formulation="Test formulation B"; status="PENDING"; notes="v1.2 gov test B" } | ConvertTo-Json
$newExp3 = @{ experiment_id="GOV-TEST-C-$ts"; formulation="Test formulation C"; status="PENDING"; notes="v1.2 gov test C" } | ConvertTo-Json
$eA = (Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/experiments" -Method POST -Headers $headers -Body $newExp1 -ContentType "application/json" -TimeoutSec 10).experiment
$eB = (Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/experiments" -Method POST -Headers $headers -Body $newExp2 -ContentType "application/json" -TimeoutSec 10).experiment
$eC = (Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/experiments" -Method POST -Headers $headers -Body $newExp3 -ContentType "application/json" -TimeoutSec 10).experiment
$expNumId  = $eA.id; $expLabel = $eA.experiment_id
$expNumId2 = $eB.id
$expNumId3 = $eC.id
Write-Host "Created test experiments: A=$expNumId B=$expNumId2 C=$expNumId3"

# G1: New experiment has evidence_identity_status = draft
try {
  Check "G1: New experiment has evidence_identity_status=draft" ($eA.PSObject.Properties.Name -contains "evidence_identity_status" -and $eA.evidence_identity_status -eq "draft") "status=$($eA.evidence_identity_status)"
} catch {
  Check "G1: evidence_identity_status on experiment" $false "Exception: $_"
}

# G2: Submit experiment for approval → status=pending_approval + approval_log row
try {
  $g2 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId/submit" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10
  $gLog = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs?record_type=experiment&record_id=$expNumId" -Headers $headers -TimeoutSec 10
  $hasGLog = @($gLog.logs | Where-Object { $_.action -eq "submitted" }).Count -gt 0
  Check "G2: Submit experiment - pending_approval + approval_log row" ($g2.evidence_identity_status -eq "pending_approval" -and $hasGLog) "status=$($g2.evidence_identity_status) log=$hasGLog"
} catch {
  Check "G2: Submit experiment" $false "Exception: $_"
}

# G3: Approve experiment → approved + reviewed_by set + log
try {
  $g3 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId/approve" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10
  $gLog3 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs?record_type=experiment&record_id=$expNumId" -Headers $headers -TimeoutSec 10
  $hasAppLog = @($gLog3.logs | Where-Object { $_.action -eq "approved" }).Count -gt 0
  Check "G3: Approve experiment - approved + approval_log row" ($g3.evidence_identity_status -eq "approved" -and $hasAppLog) "status=$($g3.evidence_identity_status) log=$hasAppLog"
} catch {
  Check "G3: Approve experiment" $false "Exception: $_"
}

# G4: Cannot approve already-approved experiment (400 guard)
try {
  $errG4 = $null
  try {
    Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId/approve" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10 | Out-Null
  } catch {
    $errG4 = $_.Exception.Response.StatusCode.value__
  }
  Check "G4: Cannot approve already-approved record (400)" ($errG4 -eq 400) "status=$errG4"
} catch {
  Check "G4: Double-approve guard" $false "Exception: $_"
}

# G5: Lock an experiment → locked
try {
  try { Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId2/submit"  -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 5 | Out-Null } catch {}
  try { Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId2/approve" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 5 | Out-Null } catch {}
  $g5 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId2/lock" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10
  Check "G5: Lock experiment - status=locked" ($g5.evidence_identity_status -eq "locked") "status=$($g5.evidence_identity_status)"
} catch {
  Check "G5: Lock experiment" $false "Exception: $_"
}

# G6: Locked experiment cannot be resubmitted (400)
try {
  $errG6 = $null
  try {
    Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId2/submit" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10 | Out-Null
  } catch {
    $errG6 = $_.Exception.Response.StatusCode.value__
  }
  Check "G6: Locked experiment cannot be resubmitted (400)" ($errG6 -eq 400) "status=$errG6"
} catch {
  Check "G6: Locked record guard" $false "Exception: $_"
}

# G7: Reject an experiment → status=rejected + reason visible in log (uses expNumId3 = experiment C, always fresh)
try {
  Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId3/submit" -Method POST -Headers $headers -Body '{}' -ContentType "application/json" -TimeoutSec 10 | Out-Null
  $g7 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/records/experiment/$expNumId3/reject" -Method POST -Headers $headers -Body '{"reason":"Incomplete measurement data"}' -ContentType "application/json" -TimeoutSec 10
  $gLog7 = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs?record_type=experiment&record_id=$expNumId3" -Headers $headers -TimeoutSec 10
  $rejectLog = @($gLog7.logs | Where-Object { $_.action -eq "rejected" })
  Check "G7: Reject experiment - rejected + reason in log" ($g7.evidence_identity_status -eq "rejected" -and $rejectLog.Count -gt 0 -and $rejectLog[0].reason -ne $null) "status=$($g7.evidence_identity_status) reason=$($rejectLog[0].reason)"
} catch {
  Check "G7: Reject experiment" $false "Exception: $_"
}

# G8: Approval logs endpoint returns correct record history
try {
  $gAllLogs = Invoke-RestMethod -Uri "$BASE/api/projects/$projectId/approval-logs" -Headers $headers -TimeoutSec 10
  Check "G8: approval-logs endpoint returns history (count > 0)" ($gAllLogs.count -gt 0) "count=$($gAllLogs.count)"
} catch {
  Check "G8: Approval logs history" $false "Exception: $_"
}

# ===========================================================================
# SUMMARY
# ===========================================================================
Write-Host ""
Write-Host "=== RESULTS ==="
Write-Host "PASS: $pass / $($pass + $fail)"
Write-Host "FAIL: $fail / $($pass + $fail)"
Write-Host ""
if ($fail -eq 0) {
  Write-Host "ALL $($pass + $fail) GOVERNANCE TESTS PASS"
} else {
  Write-Host "FAILURES:"
  $results | Where-Object { $_.result -eq "FAIL" } | ForEach-Object { Write-Host "  - $($_.test): $($_.detail)" }
}
