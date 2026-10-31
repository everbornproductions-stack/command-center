<#
  Meldmind hosted hub: one-command Cloudflare deploy (runbook: docs/hosted-hub.md).

  Run from anywhere:   powershell -ExecutionPolicy Bypass -File tools\deploy-hub.ps1
  Preview only:        powershell -ExecutionPolicy Bypass -File tools\deploy-hub.ps1 -WhatIf

  What it does, in order:
    1. Checks Docker Desktop is installed and running (wrangler builds the image with it).
    2. Checks you are signed in to Cloudflare (npx wrangler@latest whoami); if not, runs wrangler login.
    3. Reminds you the Workers Paid plan ($5/month) must be on. It does not check or buy anything;
       if the deploy fails for plan reasons it says so.
    4. Lists the secrets the Worker already has (names only).
    5. Deploys: builds the Dockerfile, pushes the image, publishes the Worker, creates the hub DNS record.
    6. Sets only the secrets that are missing:
         CC_MASTER_KEY      32 random bytes, base64, generated here and piped straight into wrangler
         CC_TICK_SECRET     32 random bytes, hex, generated here and piped straight into wrangler
         CC_SUPABASE_ANON_KEY  from server/cloud-defaults.json, CC_SUPABASE_ANON_KEY or a hidden prompt
         CC_SUPABASE_SERVICE_KEY  you paste it at a hidden prompt (never echoed)
       An existing CC_MASTER_KEY is never replaced (a new one would lose every stored API key).
    7. Calls https://<hub>/api/health and prints the result.

  No secret value is printed, written to a file, or put in git. Nothing here signs in for you,
  turns on a paid plan, or changes Supabase.
#>
param(
  [switch]$WhatIf,   # print every step, run nothing
  [switch]$Yes       # skip the "Workers Paid is on" question
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Wrangler = @("--yes", "wrangler@latest")

function Say([string]$text, [string]$color = "Gray") { Write-Host $text -ForegroundColor $color }
function Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Stop-Here([string]$text) { Write-Host ""; Write-Host $text -ForegroundColor Red; exit 1 }

# Run wrangler and return { Code, Text }. -Show also prints each line as it comes.
function Invoke-Wrangler([string[]]$WArgs, [switch]$Show) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($Show) { $out = & npx @Wrangler @WArgs 2>&1 | ForEach-Object { $line = "$_"; Write-Host $line; $line } }
    else { $out = & npx @Wrangler @WArgs 2>&1 }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prev }
  return [pscustomobject]@{ Code = $code; Text = ((@($out) | ForEach-Object { "$_" }) -join "`n") }
}

# `wrangler secret put NAME` with the value written straight to its stdin (no trailing newline, no file,
# not on the command line). The value is scrubbed from whatever wrangler prints back.
function Send-Secret([string]$name, [string]$value) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /c npx --yes wrangler@latest secret put $name"
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $p.StandardInput.Write($value)
  $p.StandardInput.Close()
  $p.WaitForExit()
  $text = ($outTask.Result + "`n" + $errTask.Result)
  if ($value) { $text = $text.Replace($value, "***") }
  return [pscustomobject]@{ Code = $p.ExitCode; Text = $text.Trim() }
}

function New-RandomBytes([int]$n) {
  $b = New-Object byte[] $n
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($b) } finally { $rng.Dispose() }
  return ,$b
}

function Read-Hidden([string]$prompt) {
  $sec = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---------- 0. where we are and which address ----------
Set-Location $Root
if (-not (Test-Path (Join-Path $Root "wrangler.jsonc"))) { Stop-Here "wrangler.jsonc not found in $Root. Run this from the command-center repo." }
$cfgText = Get-Content (Join-Path $Root "wrangler.jsonc") -Raw
$hubLine = ($cfgText -split "`n") | Where-Object { $_ -match '^\s*"CC_HUB_URL"\s*:\s*"([^"]+)"' } | Select-Object -First 1
if (-not $hubLine -or $hubLine -notmatch '"CC_HUB_URL"\s*:\s*"([^"]+)"') { Stop-Here "CC_HUB_URL is missing from wrangler.jsonc vars." }
$HubUrl = $Matches[1].TrimEnd("/")
$HubHost = ([Uri]$HubUrl).Host
$routeLine = ($cfgText -split "`n") | Where-Object { $_ -match '^\s*"routes"\s*:' } | Select-Object -First 1
if (-not $routeLine -or $routeLine -notmatch [regex]::Escape("""pattern"": ""$HubHost""")) {
  Stop-Here "The route in wrangler.jsonc does not match CC_HUB_URL ($HubHost). Fix the HUB ADDRESS lines first."
}
$WorkerName = if ($cfgText -match '"name"\s*:\s*"([^"]+)"') { $Matches[1] } else { "meldmind-hub" }

Say "Meldmind hub deploy" "White"
Say "  Worker:  $WorkerName"
Say "  Address: $HubUrl"
if ($WhatIf) { Say "  Mode:    -WhatIf (nothing below is run)" "Yellow" }

if ($WhatIf) {
  Step "1. Docker Desktop";       Say "[WhatIf] would check 'docker' is installed and 'docker info' answers; start Docker Desktop and wait up to 3 minutes if it is not running"
  Step "2. Cloudflare sign-in";   Say "[WhatIf] would run: npx wrangler@latest whoami   (and npx wrangler@latest login if not signed in)"
  Step "3. Workers Paid plan";    Say "[WhatIf] would ask you to confirm Workers Paid (`$5/month) is on (skip with -Yes). Nothing is bought here."
  Step "4. Existing secrets";     Say "[WhatIf] would run: npx wrangler@latest secret list --format json   (names only)"
  Step "5. Deploy";               Say "[WhatIf] would run: npx wrangler@latest deploy   (builds ./Dockerfile, pushes the image, publishes $WorkerName, creates DNS for $HubHost)"
  Step "6. Missing secrets";      Say "[WhatIf] would generate CC_MASTER_KEY (32 bytes, base64) and CC_TICK_SECRET (32 bytes, hex) in memory and pipe each into: npx wrangler@latest secret put NAME"
                                  Say "[WhatIf] would pipe CC_SUPABASE_ANON_KEY from server/cloud-defaults.json, the CC_SUPABASE_ANON_KEY variable, or a hidden prompt"
                                  Say "[WhatIf] would ask you to paste CC_SUPABASE_SERVICE_KEY at a hidden prompt and pipe it into wrangler"
                                  Say "[WhatIf] secrets that already exist are skipped; an existing CC_MASTER_KEY is never replaced"
  Step "7. Health check";         Say "[WhatIf] would call $HubUrl/api/health (retries for up to 3 minutes while the container starts)"
  Step "Then (by hand)";          Say "Supabase > Authentication > URL configuration: Site URL $HubUrl, Redirect URL $HubUrl/**"
  Say ""; Say "WhatIf finished. Nothing was run." "Green"
  exit 0
}

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Stop-Here "npx (Node.js) is not installed. Install Node 24 first." }

# ---------- 1. Docker ----------
Step "1. Docker Desktop"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Stop-Here "Docker is not installed. Install it with: winget install Docker.DockerDesktop  then start Docker Desktop once and run this again."
}
function Test-Docker { $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"; & docker info *> $null; $ok = ($LASTEXITCODE -eq 0); $ErrorActionPreference = $prev; return $ok }
if (-not (Test-Docker)) {
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) {
    Say "Docker is installed but not running. Starting Docker Desktop and waiting up to 3 minutes..."
    Start-Process $exe | Out-Null
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline -and -not (Test-Docker)) { Start-Sleep -Seconds 5 }
  }
  if (-not (Test-Docker)) { Stop-Here "Docker is not running. Start Docker Desktop, wait until it says 'Engine running', then run this again." }
}
Say "Docker is running." "Green"

# ---------- 2. Cloudflare sign-in ----------
Step "2. Cloudflare sign-in"
$who = Invoke-Wrangler @("whoami")
if ($who.Code -ne 0 -or $who.Text -match "not authenticated|You are not logged in") {
  Say "Not signed in to Cloudflare. Opening the browser sign-in (sign in as everbornproductions@gmail.com)..." "Yellow"
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & npx @Wrangler login
  $ErrorActionPreference = $prev
  $who = Invoke-Wrangler @("whoami")
  if ($who.Code -ne 0 -or $who.Text -match "not authenticated|You are not logged in") { Stop-Here "Still not signed in to Cloudflare. Run 'npx wrangler@latest login' and try again." }
}
$acct = ($who.Text -split "`n") | Where-Object { $_ -match "associated with the email|Account Name|logged in" } | Select-Object -First 2
if ($acct) { $acct | ForEach-Object { Say "  $_" } }
Say "Signed in." "Green"

# ---------- 3. Workers Paid ----------
Step "3. Workers Paid plan"
Say "Cloudflare Containers need the Workers Paid plan (`$5/month): dashboard > Workers & Pages > Plans."
Say "This script does not check or buy it. If the deploy fails for plan reasons, it will say so."
if (-not $Yes) {
  $ans = Read-Host "Is Workers Paid turned on for this account? (y/N)"
  if ($ans -notmatch "^(y|yes)$") { Stop-Here "Stopped. Turn on Workers Paid, then run this again (or add -Yes)." }
}

# ---------- 4. Existing secrets ----------
Step "4. Existing secrets (names only)"
$have = @()
$list = Invoke-Wrangler @("secret", "list", "--format", "json")
if ($list.Code -eq 0) {
  try {
    $json = $list.Text.Substring($list.Text.IndexOf("["))
    $have = @(($json | ConvertFrom-Json) | ForEach-Object { $_.name })
  } catch { $have = @() }
  if ($have.Count) { Say ("  already set: " + ($have -join ", ")) } else { Say "  none yet" }
} else {
  Say "  The Worker does not exist yet (first deploy)."
}
$need = @("CC_MASTER_KEY", "CC_TICK_SECRET", "CC_SUPABASE_ANON_KEY", "CC_SUPABASE_SERVICE_KEY") | Where-Object { $have -notcontains $_ }

# Collect what must be typed now, before the long build, so nothing waits at the end.
$anon = $null; $service = $null
if ($need -contains "CC_SUPABASE_ANON_KEY") {
  try { $anon = ((Get-Content (Join-Path $Root "server\cloud-defaults.json") -Raw | ConvertFrom-Json).anonKey) } catch { $anon = $null }
  if (-not $anon) { $anon = $env:CC_SUPABASE_ANON_KEY }
  if (-not $anon) { $anon = $env:SUPABASE_PUBLISHABLE_KEY }
  if (-not $anon) { $anon = Read-Hidden "Paste the Supabase publishable key (sb_publishable_..., hidden)" }
  if (-not $anon) { Stop-Here "No publishable key given." }
  if ($anon -like "sb_secret_*") { Stop-Here "That is the secret (service) key, not the publishable key. Nothing was sent." }
}
if ($need -contains "CC_SUPABASE_SERVICE_KEY") {
  Say "Supabase > Project Settings > API keys > secret key. Paste it below (it is not shown while you type)."
  $service = Read-Hidden "Paste CC_SUPABASE_SERVICE_KEY (hidden)"
  if (-not $service) { Stop-Here "No service key given." }
  if ($service -like "sb_publishable_*") { Stop-Here "That is the publishable key, not the secret key. Nothing was sent." }
}

# ---------- 5. Deploy ----------
Step "5. Deploy (builds the image with Docker; the first build takes a few minutes)"
$dep = Invoke-Wrangler @("deploy") -Show
if ($dep.Code -ne 0) {
  if ($dep.Text -match "(?i)workers paid|paid plan|upgrade your plan|not entitled|subscription|containers? (are|is) not (enabled|available)|10[0-9]{3}.*plan") {
    Stop-Here "The deploy failed for plan reasons: turn on Workers Paid (`$5/month) in the Cloudflare dashboard, then run this again."
  }
  if ($dep.Text -match "(?i)docker") { Stop-Here "The deploy failed while building the image. Check Docker Desktop is running, then run this again." }
  if ($dep.Text -match "(?i)zone|custom domain|route") { Stop-Here "The deploy failed on the hub address. $HubHost must be inside a zone in this Cloudflare account (see wrangler.jsonc HUB ADDRESS)." }
  Stop-Here "The deploy failed (see the output above). Nothing else was changed."
}
Say "Deployed." "Green"

# ---------- 6. Missing secrets ----------
Step "6. Secrets"
function Put-Secret([string]$name, [string]$value) {
  $r = Send-Secret $name $value
  if ($r.Code -ne 0) { Stop-Here "Could not set $name. wrangler said:`n$($r.Text)" }
  Say "  $name set" "Green"
}
if ($need.Count -eq 0) { Say "  All four secrets were already set. None changed." }
foreach ($name in $need) {
  switch ($name) {
    "CC_MASTER_KEY" {
      $v = [Convert]::ToBase64String((New-RandomBytes 32))
      Put-Secret $name $v; $v = $null
      Say "  (The master key lives only in Cloudflare now. Never replace it: a new key loses every stored API key.)"
    }
    "CC_TICK_SECRET" {
      $v = -join ((New-RandomBytes 32) | ForEach-Object { $_.ToString("x2") })
      Put-Secret $name $v; $v = $null
    }
    "CC_SUPABASE_ANON_KEY" { Put-Secret $name $anon; $anon = $null }
    "CC_SUPABASE_SERVICE_KEY" { Put-Secret $name $service; $service = $null }
  }
}
[GC]::Collect()

# ---------- 7. Health ----------
Step "7. Health check"
$url = "$HubUrl/api/health"
$deadline = (Get-Date).AddMinutes(3)
$result = $null; $lastErr = ""
while ((Get-Date) -lt $deadline) {
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
    $result = $resp.Content
    break
  } catch { $lastErr = $_.Exception.Message; Start-Sleep -Seconds 10 }
}
if (-not $result) { Stop-Here "No answer from $url after 3 minutes ($lastErr). Logs: npx wrangler@latest tail" }
Say "  $url" ; Say "  $result" "White"
try { $h = $result | ConvertFrom-Json } catch { $h = $null }
if ($h -and $h.ok -and $h.mode -eq "hosted") { Say "The hub is up in hosted mode (version $($h.version))." "Green" }
else { Say "The hub answered, but not as expected. Logs: npx wrangler@latest tail" "Yellow" }

Step "Next (by hand)"
Say "1. Supabase > Authentication > URL configuration: Site URL = $HubUrl ; add $HubUrl/** to Redirect URLs."
Say "2. Upload the installer to the R2 bucket everborn-downloads (docs/hosted-hub.md, 'Installer download on R2')."
Say "3. Open $HubUrl, sign in with your email, open the link on the same device."
