#requires -version 5.1
<#
  scripts/env-check.ps1 — Phase 2.5 마감 후 환경 점검 헬퍼.

  목적: Claude/Codex 세션마다 "내 cwd가 어디인지", "어느 git working tree
  를 만지고 있는지", "원격과 정말로 동기화돼 있는지", "주요 메타 파일이
  있는지"를 한 번의 호출로 확인한다. `git status` 만 보면 로컬 origin/master
  가 stale일 때도 ahead 0/behind 0으로 나와서 안전한 것처럼 보이므로
  `git ls-remote`로 실제 GitHub master SHA까지 비교한다.

  설계 원칙:
   - 읽기 전용. fetch/pull/push/commit 어떤 변경도 하지 않는다.
   - PowerShell 5.1 호환 (Windows 기본 셸). `&&`, ternary, `?.` 미사용.
   - 한국어 출력 깨짐 방지 위해 UTF-8 콘솔 인코딩으로 일시 전환.
   - 알려진 두 working tree(`harness-pipeline-analysis`, `workspace`)와
     사용자 메타 파일(`~\.claude\plans`, `~\.claude\projects\…\MEMORY.md`)
     을 차례로 점검한다.

  호출:
     pwsh.exe -File scripts/env-check.ps1
     powershell.exe -File scripts/env-check.ps1
#>

# ── 출력 인코딩 UTF-8 (한글 .md 깨짐 방지) ─────────────────────────────
$prevOutEnc = [Console]::OutputEncoding
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new() } catch { }

function Write-Section {
    param([string]$Title)
    Write-Output ""
    Write-Output ("=== " + $Title + " ===")
}

function Write-Kv {
    param([string]$Key, [string]$Value)
    Write-Output ("  " + $Key.PadRight(24) + " " + $Value)
}

function Get-GitProp {
    # NOTE: parameter is `$GitArgs`, NOT `$Args` — `$Args` is a PowerShell
    # automatic variable inside every function scope and shadowing it with
    # a typed parameter blocks splatting (`& git @Args` would silently pass
    # zero arguments, making git print `usage: git…` and exit 1).
    param([string]$RepoPath, [string[]]$GitArgs)
    if (-not (Test-Path $RepoPath)) { return "(missing)" }
    Push-Location $RepoPath
    try {
        # PowerShell 5.1: do NOT redirect a native exe's stderr to $null.
        # Doing so wraps each stderr line in a NativeCommandError record
        # and flips $? to $false even when the exe returned exit code 0.
        # We rely on $LASTEXITCODE instead — git's silent commands
        # (rev-parse, branch --show-current, config) write nothing to
        # stderr on success, so noise is a non-issue.
        $result = & git @GitArgs
        if ($LASTEXITCODE -ne 0) { return "(git exit " + $LASTEXITCODE + ")" }
        return ($result | Out-String).Trim()
    } finally {
        Pop-Location
    }
}

function Get-RemoteMasterSha {
    param([string]$RepoPath)
    if (-not (Test-Path $RepoPath)) { return "(missing)" }
    Push-Location $RepoPath
    try {
        $line = & git ls-remote origin refs/heads/master
        if ($LASTEXITCODE -ne 0 -or -not $line) { return "(unreachable)" }
        # Format is "<sha>\t<ref>" — split on whitespace, take first token.
        return ($line -split "\s+")[0]
    } finally {
        Pop-Location
    }
}

function Get-UntrackedCount {
    param([string]$RepoPath)
    if (-not (Test-Path $RepoPath)) { return -1 }
    Push-Location $RepoPath
    try {
        # PowerShell `-like "??*"` is a wildcard match where `?` means
        # "any single char" — so it matched modified, deleted, AND
        # untracked lines indiscriminately. git's untracked marker is the
        # literal two-question-mark prefix `?? `, so use a regex anchor
        # to count only those entries.
        $entries = & git status --porcelain | Where-Object { $_ -match '^\?\? ' }
        if ($LASTEXITCODE -ne 0) { return -1 }
        return @($entries).Count
    } finally {
        Pop-Location
    }
}

function Show-RepoSnapshot {
    param([string]$Label, [string]$RepoPath)
    Write-Section ("repo: " + $Label + "  (" + $RepoPath + ")")
    if (-not (Test-Path $RepoPath)) {
        Write-Kv "exists" 'NO - path missing'
        return
    }
    # Slice S1 follow-up: a directory whose .git was moved out (e.g. our
    # archived workspace shell at C:\Users\SJ\workspace) is not an error —
    # surface it as `archived` and stop instead of letting every git call
    # spam `fatal: not a git repository`.
    if (-not (Test-Path (Join-Path $RepoPath '.git'))) {
        Write-Kv 'status' 'archived (.git absent - see C:\Users\SJ\archive\ for backups)'
        return
    }
    $branch    = Get-GitProp $RepoPath @("branch", "--show-current")
    $head      = Get-GitProp $RepoPath @("rev-parse", "HEAD")
    $localOrig = Get-GitProp $RepoPath @("rev-parse", "origin/master")
    $remoteOrig = Get-RemoteMasterSha $RepoPath
    $untracked = Get-UntrackedCount $RepoPath
    $fetch     = Get-GitProp $RepoPath @("config", "--local", "remote.origin.fetch")

    Write-Kv "branch"            $branch
    Write-Kv "HEAD"              $head
    Write-Kv "origin/master"     ($localOrig + "  (local tracking ref)")
    Write-Kv "remote master SHA" ($remoteOrig + "  (live ls-remote)")
    Write-Kv "fetch refspec"     $fetch
    Write-Kv "untracked count"   ([string]$untracked)

    # Sync diagnosis. Single-quoted strings throughout — PowerShell 5.1
    # tries to parse `<`, `==`, `!=` and unbalanced parens as operators
    # even inside double-quoted literals in some scopes, so keep these
    # messages free of those tokens.
    if ($localOrig -eq $remoteOrig) {
        Write-Kv "tracking sync" 'OK - origin/master matches GitHub'
    } else {
        Write-Kv "tracking sync" 'STALE - local origin/master differs from remote; run: git fetch origin'
    }
    if ($head -eq $remoteOrig) {
        Write-Kv "HEAD vs remote" 'in-sync - HEAD matches remote master'
    } else {
        Write-Kv "HEAD vs remote" 'diverged - HEAD differs from live remote master'
    }
}

function Show-MetaFile {
    param([string]$Label, [string]$Path)
    if (Test-Path $Path) {
        $info = Get-Item $Path
        $kind = "file"
        if ($info.PSIsContainer) { $kind = "dir" }
        $size = $info.Length
        if ($info.PSIsContainer) { $size = (Get-ChildItem $Path | Measure-Object).Count }
        Write-Kv $Label ("OK (" + $kind + ", " + $size + ")  " + $Path)
    } else {
        Write-Kv $Label ("MISSING  " + $Path)
    }
}

# ── 진단 시작 ────────────────────────────────────────────────────────────
Write-Section "session"
Write-Kv "PowerShell"   $PSVersionTable.PSVersion.ToString()
Write-Kv "OutputEncoding" ([Console]::OutputEncoding.WebName)
Write-Kv "PWD"          (Get-Location).Path

# 두 working tree 점검 — 사용자 환경에서 같은 GitHub origin을 보는 두 클론.
$harnessRoot   = "C:\Users\SJ\harness-pipeline-analysis"
$workspaceRoot = "C:\Users\SJ\workspace"

Show-RepoSnapshot "harness-pipeline-analysis" $harnessRoot
Show-RepoSnapshot "workspace"                 $workspaceRoot

# 메타 파일 점검 — 환경 문서가 우선순위로 정렬한 위치.
Write-Section "meta files (priority order)"
Show-MetaFile "repo CLAUDE.md"    (Join-Path $harnessRoot "CLAUDE.md")
Show-MetaFile "repo .claude/"     (Join-Path $harnessRoot ".claude")
Show-MetaFile "workspace CLAUDE"  (Join-Path $workspaceRoot "CLAUDE.md")
Show-MetaFile "user plans dir"    "$env:USERPROFILE\.claude\plans"
Show-MetaFile "Phase 2.5 plan"    "$env:USERPROFILE\.claude\plans\swift-waddling-hanrahan.md"
Show-MetaFile "user MEMORY.md"    "$env:USERPROFILE\.claude\projects\C--Users-SJ-workspace\memory\MEMORY.md"

Write-Section "summary"
Write-Output '  Read-only diagnostic - no fetch/pull/commit/push performed.'
Write-Output '  If any tracking-sync line shows STALE, fix it with:'
Write-Output '      cd REPO_PATH; git fetch origin'
Write-Output ''

# 콘솔 인코딩 복원 (call site 영향 0)
try { [Console]::OutputEncoding = $prevOutEnc } catch { }
