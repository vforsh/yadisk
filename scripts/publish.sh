#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT/packages/yadisk"
CLI_DIR="$ROOT/packages/cli"

# Get npm token
TOKEN="${NPM_TOKEN:-$(bwx get notes "npm publish token (vforsh) [bypass 2FA]")}"
NPM_AUTH="--//registry.npmjs.org/:_authToken=$TOKEN"

# Read API package version
API_VERSION=$(jq -r .version "$API_DIR/package.json")

echo "Publishing @vforsh/yadisk@$API_VERSION..."
cd "$API_DIR"
npm publish --access public "$NPM_AUTH"

echo ""
echo "Publishing @vforsh/yadisk-cli..."
cd "$CLI_DIR"

# Replace workspace:* with real version for npm, restore on exit
cp package.json package.json.bak
trap 'mv -f "$CLI_DIR/package.json.bak" "$CLI_DIR/package.json"' EXIT
jq --arg v "^$API_VERSION" '.dependencies["@vforsh/yadisk"] = $v' package.json.bak > package.json

CLI_VERSION=$(jq -r .version package.json)
echo "Publishing @vforsh/yadisk-cli@$CLI_VERSION..."
npm publish --access public "$NPM_AUTH" --ignore-scripts

# trap restores package.json automatically

echo ""
echo "Done! Published:"
echo "  @vforsh/yadisk@$API_VERSION"
echo "  @vforsh/yadisk-cli@$CLI_VERSION"
