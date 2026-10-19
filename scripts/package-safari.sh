#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Change this bundle identifier before publishing. The extension target is
# generated as "<bundle identifier>.Extension", so it must stay prefixed by the
# app target's identifier for Xcode validation to pass.
APP_BUNDLE_ID="dev.scriptshredder.ScriptShredder"

npm run build:safari

rm -rf .output/safari
xcrun safari-web-extension-packager .output/safari-mv3 \
  --project-location .output/safari \
  --app-name ScriptShredder \
  --bundle-identifier "$APP_BUNDLE_ID" \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

cat <<EOF

Safari Xcode project: .output/safari/ScriptShredder/ScriptShredder.xcodeproj

Next steps:
  1. Open the project in Xcode.
  2. Select your development team under Signing & Capabilities.
  3. Run the "ScriptShredder" scheme.
  4. Enable the extension in Safari > Settings > Extensions.

Remove --macos-only from this script to generate an iOS/iPadOS target too.
EOF
