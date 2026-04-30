# ============================================================
# MATRIYA v1.1 - ALL 8 CONTROLLED TEST QUERIES (LOCAL)
# Flow: POST /research/session (with project_id) → 
#       POST /api/research/run (with session_id)
# ============================================================
# UTF-8 encoding so Hebrew characters render correctly in terminal
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$BASE           = "https://matriya-system-project-production.up.railway.app"
$ACTIVE_ID      = "aaaaaaaa-0001-0001-0001-000000000001"
$INCOMPLETE_ID  = "bbbbbbbb-0002-0002-0002-000000000002"

Write-Host "=================================================="
Write-Host " MATRIYA v1.1 - LOCAL TEST SUITE"
Write-Host " Server : $BASE"
Write-Host " ACTIVE : $ACTIVE_ID"
Write-Host " INCOMPLETE: $INCOMPLETE_ID"
Write-Host "=================================================="

# ─── helper: create session ────────────────────────────────
function New-Session {
    param([string]$ProjectId = "")
    $body = @{}
    if ($ProjectId) { $body["project_id"] = $ProjectId }
    $json = $body | ConvertTo-Json
    try {
        $r = Invoke-WebRequest -Uri "$BASE/research/session" -Method POST `
              -Body $json -ContentType "application/json" -UseBasicParsing -TimeoutSec 15
        $sid = ($r.Content | ConvertFrom-Json).session_id
        Write-Host "  Session created: $sid  (project=$ProjectId)"
        return $sid
    } catch {
        $errMsg = $_.Exception.Message
        $errBody = ""
        try { $errBody = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream()).ReadToEnd() } catch {}
        Write-Host "  ERROR creating session: $errMsg | $errBody"
        return $null
    }
}

# ─── helper: run a research query ──────────────────────────
function Run-Q {
    param(
        [string]$QLabel,
        [string]$SessionId,
        [string]$Query,
        [bool]  $ProjectMode = $true
    )
    Write-Host ""
    Write-Host "----------------------------------------------"
    Write-Host ">>> $QLabel"
    Write-Host "----------------------------------------------"

    if (-not $SessionId) {
        Write-Host "  SKIP: no session_id"
        return $null
    }

    $body = [ordered]@{
        query        = $Query
        session_id   = $SessionId
        project_mode = $ProjectMode
    }
    $json = $body | ConvertTo-Json

    try {
        $resp = Invoke-WebRequest -Uri "$BASE/api/research/run" -Method POST `
                    -Body $json -ContentType "application/json" `
                    -UseBasicParsing -TimeoutSec 120
        $r = $resp.Content | ConvertFrom-Json

        Write-Host "  decision_status   : $($r.decision_status)"
        Write-Host "  recommended_action: $($r.recommended_action)"

        $reas = if ($r.reasoning) { $r.reasoning.ToString() } else { "(none)" }
        $ans  = if ($r.answer)    { $r.answer.ToString()    } else { "(none)" }
        Write-Host "  reasoning (500ch) : $($reas.Substring(0,[Math]::Min(500,$reas.Length)))"
        Write-Host "  answer    (500ch) : $($ans.Substring(0,[Math]::Min(500,$ans.Length)))"

        Write-Host "  experiments used  :"
        if ($r.selected_experiments -and $r.selected_experiments.Count -gt 0) {
            foreach ($e in $r.selected_experiments) {
                Write-Host "    - $($e.experiment_id) [project: $($e.project_id)]"
            }
        } else { Write-Host "    (none)" }

        return $r
    } catch {
        $errMsg = $_.Exception.Message
        Write-Host "  ERROR: $errMsg"
        try {
            $body2 = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream()).ReadToEnd()
            Write-Host "  BODY : $body2"
        } catch {}
        return $null
    }
}

# ─── Create sessions ───────────────────────────────────────
Write-Host ""
Write-Host "=== CREATING SESSIONS ==="
$SID_STOP       = New-Session            # no project_id → for Q_STOP
$SID_ACTIVE_1   = New-Session $ACTIVE_ID  # for Q1
$SID_ACTIVE_2   = New-Session $ACTIVE_ID  # for Q2
$SID_ACTIVE_3   = New-Session $ACTIVE_ID  # for Q3
$SID_INC_4      = New-Session $INCOMPLETE_ID  # for Q4
$SID_INC_5      = New-Session $INCOMPLETE_ID  # for Q5
$SID_INC_6      = New-Session $INCOMPLETE_ID  # for Q6
$SID_INC_7      = New-Session $INCOMPLETE_ID  # for Q7
$SID_GLOBAL_8   = New-Session            # no project_id → for Q8 (global mode)

# ─── Q_STOP: project_mode=true, no project in session ──────
Write-Host ""
Write-Host "=== Q_STOP: project_mode=true, session has NO project_id ==="
if ($SID_STOP) {
    $bodyStop = [ordered]@{ query = "propose a formulation"; session_id = $SID_STOP; project_mode = $true } | ConvertTo-Json
    try {
        $rStop = (Invoke-WebRequest -Uri "$BASE/api/research/run" -Method POST -Body $bodyStop -ContentType "application/json" -UseBasicParsing -TimeoutSec 30).Content | ConvertFrom-Json
        Write-Host "  decision_status   : $($rStop.decision_status)    (expected: STOP)"
        Write-Host "  recommended_action: $($rStop.recommended_action)  (expected: NEED_SELECTED_PROJECT)"
        Write-Host "  reasoning         : $($rStop.reasoning)"
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)"
        try { Write-Host "  BODY: $([System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream()).ReadToEnd())" } catch {}
    }
} else { Write-Host "  SKIP: session creation failed" }

# ─── Q1 ─────────────────────────────────────────────────────
$r1 = Run-Q -QLabel "Q1: ACTIVE propose candidate formulation" `
    -SessionId $SID_ACTIVE_1 -ProjectMode $true `
    -Query "For project INT-TFX-ACTIVE, propose one candidate formulation for the next lab experiment to improve adhesion beyond 95% while keeping expansion_ratio above 20. Use only this project's materials and experiments. Return: 1. project_id 2. candidate_id 3. materials and percentages 4. role of each material 5. expected mechanism 6. risks/missing data 7. exact lab test 8. decision_status 9. recommended_action"

$r2 = Run-Q -QLabel "Q2: ACTIVE compare EXP-001 vs EXP-004" `
    -SessionId $SID_ACTIVE_2 -ProjectMode $true `
    -Query "Compare EXP-001 and EXP-004 from project INT-TFX-ACTIVE. Which performs better and why? Use only this project's data. Return decision_status and recommended_action."

$r3 = Run-Q -QLabel "Q3: ACTIVE list missing data for humid fire protection" `
    -SessionId $SID_ACTIVE_3 -ProjectMode $true `
    -Query "For project INT-TFX-ACTIVE, list missing data needed to fully optimize the formulation for fire protection in humid environments. Use only this project's data."

$r4 = Run-Q -QLabel "Q4: INCOMPLETE propose formulation" `
    -SessionId $SID_INC_4 -ProjectMode $true `
    -Query "For project INT-TFX-INCOMPLETE, propose one candidate formulation to improve adhesion. Use only this project's materials and experiments."

$r5 = Run-Q -QLabel "Q5: INCOMPLETE compare EXP-102 vs EXP-103" `
    -SessionId $SID_INC_5 -ProjectMode $true `
    -Query "Compare EXP-102 and EXP-103 from project INT-TFX-INCOMPLETE. Use only this project's data. Return what can be compared and what is missing."

$r6 = Run-Q -QLabel "Q6: INCOMPLETE what data is missing" `
    -SessionId $SID_INC_6 -ProjectMode $true `
    -Query "What specific data is missing in project INT-TFX-INCOMPLETE to make a reliable formulation decision? Use only this project's data."

$r7 = Run-Q -QLabel "Q7: Isolation INCOMPLETE only no ACTIVE leak" `
    -SessionId $SID_INC_7 -ProjectMode $true `
    -Query "While project INT-TFX-INCOMPLETE is selected, list all lab experiments available in the selected project. Use only the selected project_id. Do not use INT-TFX-ACTIVE data. Return: 1. selected project_id 2. experiments found 3. whether any INT-TFX-ACTIVE experiment appears: YES/NO 4. decision_status"

$r8 = Run-Q -QLabel "Q8: Global mode output must begin with MODE GLOBAL" `
    -SessionId $SID_GLOBAL_8 -ProjectMode $false `
    -Query "Run a global research analysis across all available lab data. Label the output clearly as: MODE: GLOBAL. Do not claim this is project-specific."

# ══════════════════════════════════════════════════════════
# PASS / FAIL SUMMARY
# ══════════════════════════════════════════════════════════
Write-Host ""
Write-Host "=================================================="
Write-Host " PASS / FAIL SUMMARY"
Write-Host "=================================================="

function Chk { param($lbl, $got, [string[]]$ok)
    $pass = ($ok | Where-Object { $_ -ieq $got }) -ne $null
    $mark = if ($pass) { "PASS" } else { "FAIL (got='$got' expected: $($ok -join '|'))" }
    Write-Host "  $lbl : $mark"
    return $pass
}

$p_stop = (($rStop.decision_status -ieq "STOP") -and ($rStop.recommended_action -ieq "NEED_SELECTED_PROJECT"))
Write-Host "  Q_STOP : $(if($p_stop){'PASS'}else{'FAIL'}) | ds=$($rStop.decision_status) ra=$($rStop.recommended_action)"

$p1 = (Chk "Q1 decision_status   " $r1.decision_status    @("GO","ITERATE")) -and
      (Chk "Q1 recommended_action" $r1.recommended_action  @("TEST"))

$r2text = if($r2.answer){$r2.answer.ToString()}elseif($r2.reasoning){$r2.reasoning.ToString()}else{""}
$p2 = (Chk "Q2 decision_status   " $r2.decision_status    @("GO","ITERATE")) -and ($r2text -match "EXP-004")
Write-Host "  Q2 EXP-004 mentioned : $(if($r2text -match 'EXP-004'){'PASS'}else{'FAIL'}) | text excerpt: $($r2text.Substring(0,[Math]::Min(150,$r2text.Length)))"

$p3 = (Chk "Q3 decision_status   " $r3.decision_status    @("ITERATE")) -and
      (Chk "Q3 recommended_action" $r3.recommended_action  @("NEED_MORE_DATA"))

$p4 = (Chk "Q4 decision_status   " $r4.decision_status    @("INSUFFICIENT_DATA")) -and
      (Chk "Q4 recommended_action" $r4.recommended_action  @("NEED_MORE_DATA"))

$p5 = (Chk "Q5 decision_status   " $r5.decision_status    @("ITERATE","INSUFFICIENT_DATA"))

$p6 = (Chk "Q6 decision_status   " $r6.decision_status    @("ITERATE")) -and
      (Chk "Q6 recommended_action" $r6.recommended_action  @("NEED_MORE_DATA"))

# Q7 isolation
$leak = $false
if ($r7 -and $r7.selected_experiments) {
    foreach ($e in $r7.selected_experiments) {
        if ($e.project_id -eq $ACTIVE_ID) { $leak = $true }
    }
}
$r7ans = if ($r7.answer) { $r7.answer.ToString().ToUpper() } else { "" }
$leakText = $r7ans -match "EXP-00[1-9]|INT-TFX-ACTIVE"
$p7 = (-not $leak) -and (-not $leakText)
Write-Host "  Q7 isolation : $(if($p7){'PASS'}else{'FAIL'}) | data_leak=$leak | text_leak=$leakText"

# Q8
$r8text = if($r8.answer){$r8.answer.ToString()}elseif($r8.reasoning){$r8.reasoning.ToString()}else{""}
$p8 = $r8text -match "MODE.*GLOBAL|GLOBAL.*MODE|MODE: GLOBAL"
Write-Host "  Q8 MODE:GLOBAL : $(if($p8){'PASS'}else{'FAIL'}) | text start: $($r8text.Substring(0,[Math]::Min(100,$r8text.Length)))"

Write-Host ""
$allPass = $p_stop -and $p1 -and $p2 -and $p3 -and $p4 -and $p5 -and $p6 -and $p7 -and $p8
if ($allPass) {
    Write-Host "  *** ALL QUERIES PASS — READY TO CONFIRM DEPLOY ***"
} else {
    Write-Host "  *** SOME FAILED — NEED CODE FIXES ***"
}
