# amicus installer — a thin, readable wrapper over `npm install -g amicus`.
#
#   irm https://raw.githubusercontent.com/BourbonDog/amicus/main/install.ps1 | iex
#
# It only checks that Node.js >= 22.12 is present, then installs amicus globally.
# amicus's own postinstall does the rest (registers the MCP server, installs the
# two skills). Nothing here writes to your machine except via npm.
$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "› $m"  -ForegroundColor Cyan }
function Ok($m)   { Write-Host "✓ $m"  -ForegroundColor Green }
function Fail($m) { Write-Host "✗ $m"  -ForegroundColor Red }

Info 'Installing amicus…'

# 1. Require Node.js >= 22.12
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail 'Node.js is required but was not found on your PATH.'
  Fail 'Install Node 22.12+ from https://nodejs.org, then re-run this script.'
  exit 1
}
$major = 0
$minor = 0
try {
  $major = [int](node -p 'process.versions.node.split(".")[0]')
  $minor = [int](node -p 'process.versions.node.split(".")[1]')
} catch { $major = 0; $minor = 0 }
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 12)) {
  Fail "amicus needs Node.js >= 22.12 (found $(node -v)). Update from https://nodejs.org."
  exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail 'npm was not found on your PATH (it normally ships with Node.js).'
  exit 1
}
Ok "Node $(node -v) detected."

# 2. Install globally (runs amicus's postinstall: MCP registration + skills)
Info 'Running: npm install -g amicus'
npm install -g amicus
if ($LASTEXITCODE -ne 0) {
  Fail 'Global install failed. Open a new terminal, or check your npm global permissions.'
  exit 1
}

Ok 'amicus installed.'
Write-Host ''
Info 'Next steps:'
Info '  amicus setup      # configure API keys + your default model'
Info '  amicus --help     # see all commands'
Info 'Then, in Claude Code or Cowork, just say:  "council review this"'
