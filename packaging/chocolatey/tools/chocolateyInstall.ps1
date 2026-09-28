# UNTESTED until an elevated local install passes: `choco pack` in packaging/chocolatey/,
# then, from an elevated prompt in that same directory,
# `choco install amicus --source "'.;https://community.chocolatey.org/api/v2/'"`. The full
# test is in amicus.nuspec's header. Repo home: packaging/chocolatey/tools/chocolateyInstall.ps1
# See docs/DISTRIBUTION.md section 4 (Chocolatey) for the rationale behind the decisions below.

$ErrorActionPreference = 'Stop'

$packageName = 'amicus'
$packageVersion = $env:chocolateyPackageVersion

# --- THE KEY RISK (read before changing this) -------------------------------------------
# amicus's own npm postinstall (scripts/postinstall.js) registers the MCP server and copies
# both skills into the CURRENT PROCESS's user profile:
#   - src/utils/claude-register.js :: skillsRoot            -> path.join(os.homedir(), '.claude', 'skills')
#   - src/utils/claude-register.js :: registerClaudeCode    -> path.join(os.homedir(), '.claude.json')
#   - src/utils/claude-register.js :: registerClaudeDesktop -> path.join(process.env.APPDATA || '', 'Claude') on win32
# None of these resolve the *interactive* user; they resolve whichever account the running
# process belongs to. `choco install` commonly runs elevated, sometimes as a different admin
# account or as SYSTEM -- in either case os.homedir()/%APPDATA% resolve to THAT account's
# profile, not the person who will actually run `amicus`. The registration would still
# "succeed" (no error, no non-zero exit -- scripts/postinstall.js's runCli() wrapper always
# exits 0), so this is a *silent* misplacement, not a visible failure: Claude Code running as
# the real user would simply never see the MCP server or skills. grep of
# src/utils/claude-register.js for "SYSTEM"/"elevated"/"admin"/"getuid" is empty (0 hits) --
# there is no existing guard against this.
#
# Fix: set AMICUS_SKIP_POSTINSTALL=1 for the npm install alone -- the try below sets it
# directly before the npm call, and its finally removes it. This is the SAME guard the Claude
# Code plugin channel already relies on (.claude-plugin/plugin.json's mcpServers.amicus.env),
# and it is scoped precisely to amicus's own postinstall -- scripts/postinstall.js :: main's
# first statement, `if (process.env.AMICUS_SKIP_POSTINSTALL === '1')`, returns before the
# skill copy, the MCP registration, AND the Electron GUI cache-only provisioning step. It is
# NOT the same as npm's --ignore-scripts: that would also skip the bundled opencode-ai
# dependency's OWN postinstall (which lays down its ~11 per-platform engine binaries, per
# README's Requirements & Dependencies section) -- AMICUS_SKIP_POSTINSTALL=1 leaves that one
# alone.
#
# The guard fixes only the registration half. This package currently supports same-account
# elevation only: npm's global prefix is per-account (Node's bundled npmrc sets
# prefix=${APPDATA}\npm), so under a different admin account or SYSTEM, amicus and its
# amicus/am shims land in that account's %APPDATA%\npm, off the interactive user's PATH --
# and the install still exits 0. A machine-wide prefix is the alternative; choosing it is an
# owner decision (B-REL-5), deliberately not made in this draft.
try {
  # nodejs-lts is a nuspec <dependency>, so Chocolatey installs it first -- but PATH may not
  # be refreshed in THIS elevated session yet. Update-SessionEnvironment (aliased `refreshenv`)
  # is a standard Chocolatey helper for exactly this
  # (https://docs.chocolatey.org/en-us/create/functions/update-sessionenvironment).
  Update-SessionEnvironment
  Get-Command npm | Out-Null  # still no npm on PATH: fail here, loudly

  $npmArgs = @('install', '--global', "$packageName@$packageVersion")
  Write-Host "Running: npm $($npmArgs -join ' ')"
  # npm writes its warnings to stderr, and Windows PowerShell 5.1 (the engine Chocolatey runs
  # this under) turns every stderr line that 2>&1 redirects into a terminating error while
  # $ErrorActionPreference is 'Stop'. Relax it for this one call; $LASTEXITCODE is the real
  # failure signal.
  $ErrorActionPreference = 'Continue'
  $env:AMICUS_SKIP_POSTINSTALL = '1'
  & npm @npmArgs 2>&1 | Write-Host
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) {
    throw "npm install -g $packageName exited with code $LASTEXITCODE"
  }
} finally {
  Remove-Item Env:\AMICUS_SKIP_POSTINSTALL -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$packageName was installed globally via npm; amicus's postinstall registration was skipped"
Write-Host '(see the KEY RISK note in chocolateyInstall.ps1). This package currently supports'
Write-Host 'same-account elevation only: npm''s global prefix is per-account (Node''s bundled npmrc'
Write-Host 'sets prefix=${APPDATA}\npm), so under a different admin account or SYSTEM, amicus and its'
Write-Host 'amicus/am shims land in that account''s %APPDATA%\npm, off the interactive user''s PATH.'
Write-Host ''
Write-Host 'From an ORDINARY, non-elevated prompt, check that `where.exe amicus` finds it, then run:'
Write-Host ''
Write-Host '    amicus init      # registers the MCP server + skills for YOUR account'
Write-Host '    amicus setup     # add a model API key (OpenRouter recommended)'
Write-Host '    amicus doctor    # confirm everything is green'
Write-Host ''
