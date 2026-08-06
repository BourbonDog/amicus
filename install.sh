#!/bin/sh
# amicus installer — a thin, readable wrapper over `npm install -g amicus`.
#
#   curl -fsSL https://raw.githubusercontent.com/BourbonDog/amicus/main/install.sh | sh
#
# It only checks that Node.js >= 22.12 is present, then installs amicus globally.
# amicus's own postinstall does the rest (registers the MCP server, installs the
# two skills). Nothing here writes to your machine except via npm.
set -eu

info() { printf '\033[36m›\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
err()  { printf '\033[31m✗\033[0m %s\n' "$1" >&2; }

info "Installing amicus…"

# 1. Require Node.js >= 22.12
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but was not found on your PATH."
  err "Install Node 22.12+ from https://nodejs.org, then re-run this script."
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)
NODE_VER_NUM=$((NODE_MAJOR * 1000 + NODE_MINOR))
if [ "$NODE_VER_NUM" -lt 22012 ]; then
  err "amicus needs Node.js >= 22.12 (found $(node -v)). Update from https://nodejs.org."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  err "npm was not found on your PATH (it normally ships with Node.js)."
  exit 1
fi
ok "Node $(node -v) detected."

# 2. Install globally (runs amicus's postinstall: MCP registration + skills)
info "Running: npm install -g amicus"
if ! npm install -g amicus; then
  err "Global install failed."
  err "A permissions error usually means npm's global prefix needs elevation, or"
  err "you can point npm at a user-writable prefix. See:"
  err "https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
  exit 1
fi

ok "amicus installed."
printf '\n'
info "Next steps:"
info "  amicus setup      # configure API keys + your default model"
info "  amicus --help     # see all commands"
info 'Then, in Claude Code or Cowork, just say:  "council review this"'
