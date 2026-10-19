#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Pass your own bundle identifier as the first argument if this placeholder
# collides with an existing App ID. The extension target is generated as
# "<bundle identifier>.Extension".
APP_BUNDLE_ID="${1:-dev.scriptshredder.ScriptShredder}"
# The extension manifest requires Safari 26, so iOS 26 is the practical floor.
DEPLOYMENT_TARGET="${2:-26.0}"
# Optional. When set, both targets get this development team in the project.
TEAM_ID="${3:-}"

npm run build:safari

rm -rf .output/safari-ios
xcrun safari-web-extension-packager .output/safari-mv3 \
  --project-location .output/safari-ios \
  --app-name ScriptShredder \
  --bundle-identifier "$APP_BUNDLE_ID" \
  --ios-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

PROJECT_FILE=".output/safari-ios/ScriptShredder/ScriptShredder.xcodeproj/project.pbxproj"

# The packager targets the current SDK (for example iOS 27.0). Lower the app
# and extension targets so the build also installs on iOS 26 devices.
perl -0pi -e "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET};/g" "$PROJECT_FILE"

# The packager may normalize the requested identifier (for example, by using
# the app name as the final component). Force the exact requested app ID and a
# child extension ID, which Xcode requires for embedded binaries.
perl -0pi -e "s/(INFOPLIST_FILE = ScriptShredder\/Info\.plist;.*?PRODUCT_BUNDLE_IDENTIFIER = )[^;]+;/\${1}${APP_BUNDLE_ID};/sg" "$PROJECT_FILE"
perl -0pi -e "s/(INFOPLIST_FILE = \"ScriptShredder Extension\/Info\.plist\";.*?PRODUCT_BUNDLE_IDENTIFIER = )[^;]+;/\${1}${APP_BUNDLE_ID}.Extension;/sg" "$PROJECT_FILE"

if [ -n "$TEAM_ID" ]; then
  perl -0pi -e 's/\n\s*DEVELOPMENT_TEAM = [^;]+;//g' "$PROJECT_FILE"
  perl -0pi -e "s/(CODE_SIGN_STYLE = Automatic;)/\$1\n\t\t\t\tDEVELOPMENT_TEAM = ${TEAM_ID};/g" "$PROJECT_FILE"
fi

if [ -n "$TEAM_ID" ]; then
  TEAM_LINE="Development team: ${TEAM_ID}"
else
  TEAM_LINE="Development team: choose one in Xcode"
fi

cat <<EOF

iOS Xcode project: .output/safari-ios/ScriptShredder/ScriptShredder.xcodeproj
iOS deployment target: ${DEPLOYMENT_TARGET}
App bundle ID: ${APP_BUNDLE_ID}
Extension bundle ID: ${APP_BUNDLE_ID}.Extension
${TEAM_LINE}

Next steps:
  1. Open the project in Xcode.
  2. Select your development team under Signing & Capabilities for BOTH the
     ScriptShredder and ScriptShredder Extension targets.
  3. Select your iPhone as the run destination and press Run.
  4. Trust the developer app on the iPhone if prompted.
  5. Enable the extension in Settings > Apps > Safari > Extensions.

A free Apple ID install expires after 7 days. Use a paid developer team,
TestFlight, or Ad Hoc distribution for a longer-lived install.
EOF
