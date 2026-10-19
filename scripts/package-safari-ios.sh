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

# The packager targets the current SDK (for example iOS 27.0). Lower the app
# and extension targets so the build also installs on iOS 26 devices.
PROJECT_FILE=".output/safari-ios/ScriptShredder/ScriptShredder.xcodeproj/project.pbxproj"
XCODE_PROJECT=".output/safari-ios/ScriptShredder/ScriptShredder.xcodeproj"
perl -0pi -e "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET};/g" "$PROJECT_FILE"

# Xcode's automatic signing can resolve the app to an existing App Store
# Connect record, and some packager versions then use that same identifier for
# the extension target. Force the extension identifier to be a child of the
# actual app identifier, which Xcode requires for embedded binaries.
APP_ID="$(xcodebuild -project "$XCODE_PROJECT" -target ScriptShredder -configuration Release -showBuildSettings 2>/dev/null | awk -F' = ' '/^[[:space:]]*PRODUCT_BUNDLE_IDENTIFIER = / { print $2; exit }')"
if [ -z "$APP_ID" ]; then
  echo "Could not read the app bundle identifier from the generated project." >&2
  exit 1
fi
EXTENSION_ID="${APP_ID}.Extension"
perl -0pi -e "s/(INFOPLIST_KEY_CFBundleDisplayName = \"ScriptShredder for Safari\";.*?PRODUCT_BUNDLE_IDENTIFIER = )[^;]+;/\${1}${EXTENSION_ID};/sg" "$PROJECT_FILE"

cat <<EOF

iOS Xcode project: .output/safari-ios/ScriptShredder/ScriptShredder.xcodeproj
iOS deployment target: ${DEPLOYMENT_TARGET}
App bundle ID: ${APP_ID}
Extension bundle ID: ${EXTENSION_ID}

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
