# Installs Opencode++ for Windows with one command. In PowerShell:
#
#   irm https://raw.githubusercontent.com/NeiP4n/opencode-plus-plus/lan-rooms/opencode-pp-install.ps1 | iex
#
# Missing Git comes from winget, Bun from bun.sh. The newest release is checked
# out into %LOCALAPPDATA%\opencode-pp and the `opencode-pp` command is added to your
# user PATH, so it works in this window right away. A regular opencode keeps the
# `opencode` command. Running this again updates.
# `irm ... | iex` runs this in the caller's PowerShell session, so a plain assignment here would
# leave `Stop` behind and turn every later error in that window into a terminating one. The whole
# body therefore runs in a child scope, where the preference dies with the script.
& {
$ErrorActionPreference = "Stop"

$Repo = if ($env:OPENCODE_PP_REPO) { $env:OPENCODE_PP_REPO } else { "https://github.com/NeiP4n/opencode-plus-plus.git" }
$Dir = if ($env:OPENCODE_PP_DIR) { $env:OPENCODE_PP_DIR } else { Join-Path $env:LOCALAPPDATA "opencode-pp" }
$Bin = Join-Path $Dir "bin"
$Branch = if ($env:OPENCODE_PP_BRANCH) { $env:OPENCODE_PP_BRANCH } else { "lan-rooms" }

# Programs installed below land in the machine or user PATH; this window only sees them after a refresh.
# Anything the session already had is kept: rebuilding the variable from the two stored PATHs alone
# drops entries a profile or a running tool added just for this window, and the installer then cannot
# find what it installed a moment earlier.
function Update-SessionPath {
  $Known = @(
    [Environment]::GetEnvironmentVariable("Path", "Machine"),
    [Environment]::GetEnvironmentVariable("Path", "User"),
    "$env:USERPROFILE\.bun\bin"
  )
  $Current = @($env:Path -split ";") + $Known
  $env:Path = (@($Current | Where-Object { $_ } | Select-Object -Unique) -join ";")
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Git is required and winget is not available. Install Git from https://git-scm.com/download/win, then run this again."
  }
  Write-Host "Installing Git..."
  winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
  Update-SessionPath
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git was installed but is not on PATH yet. Open a new PowerShell and run this again."
  }
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  powershell -NoProfile -ExecutionPolicy Bypass -c "irm bun.sh/install.ps1 | iex"
  Update-SessionPath
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "Bun did not install. See https://bun.sh for a manual install." }
}

$Source = Join-Path $Dir "src"
if (Test-Path (Join-Path $Source ".git")) {
  Write-Host "Updating $Source..."
  git -C $Source fetch --tags --force origin
} else {
  Write-Host "Downloading Opencode++ into $Source..."
  git clone --filter=blob:none $Repo $Source
}
if ($LASTEXITCODE -ne 0) { throw "git failed." }

# A release tag is the normal path. Before the first release exists there is nothing to check
# out, and an installer that only knows tags leaves a newcomer with no way in, so the branch
# with the patches is the fallback.
$Tag = git -C $Source tag -l "release/*" --sort=-v:refname | Select-Object -First 1
if ($Tag) {
  $Target = $Tag
  $Version = $Tag -replace "^release/", ""
} else {
  Write-Host "No release is published yet; installing branch $Branch."
  git -C $Source fetch --force origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }
  $Target = "origin/$Branch"
  $Version = "$Branch (no release yet)"
}

# A previous run or a developer may have left tracked/untracked edits in this checkout.
# Stash them before checkout; never discard the user's work to make an update succeed.
$LocalChanges = git -C $Source status --porcelain
if ($LASTEXITCODE -ne 0) { throw "Could not inspect local changes in $Source." }
$StashedLocalChanges = $false
if ($LocalChanges) {
  Write-Host "Preserving local changes before updating..."
  git -C $Source stash push --include-untracked --message "opencode-pp installer update $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')"
  if ($LASTEXITCODE -ne 0) { throw "Could not save local changes; no checkout was attempted." }
  $StashedLocalChanges = $true
}

try {
  git -C $Source checkout --quiet --detach $Target
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed." }
} finally {
  if ($StashedLocalChanges) {
    Write-Host "Restoring local changes..."
    git -C $Source stash pop
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Some local changes conflict with the updated source. The saved copy will remain in Git stash."
      git -C $Source reset --hard --quiet
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "Git could not clean the partially applied changes. Inspect the checkout before running the installer again."
      }
      Write-Host "Recover the saved work with: git -C `"$Source`" stash list"
      Write-Host "Then inspect/apply the relevant stash after resolving the conflict."
    }
  }
}

Write-Host "Installing dependencies..."
Push-Location $Source
# Only what the terminal app needs; the web and desktop apps pull far more.
bun install --frozen-lockfile --filter ./packages/cli
$Installed = $LASTEXITCODE
Pop-Location
if ($Installed -ne 0) { throw "bun install failed." }

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Bun = (Get-Command bun).Source
$Cli = Join-Path $Source "packages\cli"
# The command is `opencode-pp`, so a regular opencode on the same machine keeps `opencode`.
# The preload goes by absolute path: bunfig.toml names it by package, which Bun resolves from
# the directory the command is started in.
# A console left on its OEM code page (866, 437 and so on) turns the interface's symbols into `?`, so the
# command switches it to UTF-8 while it runs and puts the old code page back on exit.
# The file is written as UTF-8 without a BOM, never as ASCII: the paths baked into it come from the
# user's own profile, and a non-ASCII name (`C:\Users\Иван\...`) encoded as ASCII becomes `????`, which
# leaves a command that cannot find bun or the sources at all. A BOM is not wanted either - cmd.exe
# runs a BOM as part of the first line and the wrapper stops being a wrapper.
$Wrapper = @"
@echo off
setlocal
for /f "tokens=2 delims=:" %%c in ('chcp') do set /a OPENCODE_PP_CP=%%c
chcp 65001 >nul
set OPENCODE_COMMAND=opencode-pp
"$Bun" --preload="$Cli\node_modules\@opentui\solid\scripts\preload.js" "$Cli\src\index.ts" %*
set OPENCODE_PP_EXIT=%ERRORLEVEL%
if defined OPENCODE_PP_CP chcp %OPENCODE_PP_CP% >nul
exit /b %OPENCODE_PP_EXIT%
"@
[System.IO.File]::WriteAllText((Join-Path $Bin "opencode-pp.cmd"), $Wrapper, (New-Object System.Text.UTF8Encoding($false)))
# Earlier versions of this installer took the name `opencode` in this folder; give it back.
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Bin "opencode.cmd")

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath -split ";" | Where-Object { $_ -eq $Bin })) {
  [Environment]::SetEnvironmentVariable("Path", (@($UserPath, $Bin) | Where-Object { $_ }) -join ";", "User")
  Write-Host "Added $Bin to your PATH."
}
# `irm | iex` runs in this window, so the command works here without reopening it.
if (-not ($env:Path -split ";" | Where-Object { $_ -eq $Bin })) { $env:Path = "$env:Path;$Bin" }

Write-Host ""
Write-Host "Opencode++ $Version is installed. Run: opencode-pp"
}
