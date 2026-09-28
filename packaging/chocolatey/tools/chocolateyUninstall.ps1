# UNTESTED until an elevated local install passes (see amicus.nuspec's header). Repo home:
# packaging/chocolatey/tools/chocolateyUninstall.ps1. See docs/DISTRIBUTION.md section 4 (Chocolatey).

$ErrorActionPreference = 'Stop'

$packageName = 'amicus'

# amicus is installed as a global npm package (see chocolateyInstall.ps1); Chocolatey's own
# file tracking never owned those files, so the uninstall must explicitly reverse the wrapped
# `npm install -g amicus`. Tolerate a non-zero exit rather than throw -- npm may already be
# gone (e.g. nodejs-lts was uninstalled first in a bulk `choco uninstall`), and a failed
# uninstall script leaves the package stuck in a bad state for the user.
$removed = $false
try {
  # As in chocolateyInstall.ps1: under Windows PowerShell 5.1, npm's stderr warnings would
  # otherwise become terminating errors, so relax the preference for this one call.
  $ErrorActionPreference = 'Continue'
  & npm uninstall --global $packageName 2>&1 | Write-Host
  if ($LASTEXITCODE -eq 0) {
    $removed = $true
  } else {
    Write-Warning "npm uninstall -g $packageName exited with code $LASTEXITCODE (continuing)."
  }
} catch {
  Write-Warning "npm uninstall -g $packageName failed: $_"
} finally {
  $ErrorActionPreference = 'Stop'
}

Write-Host ''
if ($removed) {
  Write-Host "$packageName removed from this account's npm global packages."
} else {
  Write-Host "npm uninstall did not succeed (see the warning above), so $packageName may still be installed."
}
Write-Host 'This package never registered the MCP server or copied skills at install time'
Write-Host '(chocolateyInstall.ps1 sets AMICUS_SKIP_POSTINSTALL=1), so there is nothing under'
Write-Host '~/.claude, ~/.claude.json or %APPDATA%\Claude for it to clean up here. If you ran'
Write-Host '`amicus init` / `amicus setup` yourself afterward, remove those by hand if wanted:'
Write-Host '  - %USERPROFILE%\.claude\skills\sidecar, %USERPROFILE%\.claude\skills\second-opinion'
Write-Host '  - the "amicus" entry in %USERPROFILE%\.claude.json and %APPDATA%\Claude\claude_desktop_config.json'
Write-Host '  - %USERPROFILE%\.config\amicus (API keys, session history)'
Write-Host ''
