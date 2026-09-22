#!/usr/bin/env bash
# Packs this checkout's JS into a built release APK: `usage: rebundle-android-app.sh <in.apk> <out.apk>`.
# The bundle is the one Gradle's createBundleReleaseJsAndAssets left under android/app/build, and the
# APK is signed again with the debug keystore expo prebuild writes, which is what assembleRelease signs with.
set -euo pipefail

in="$1"
out="$2"
bundle="$PWD/android/app/build/generated/assets/react/release/index.android.bundle"
[ -s "$bundle" ] || { echo "::error::No bundle at $bundle; createBundleReleaseJsAndAssets has not run."; exit 1; }
[ -s "$in" ] || { echo "::error::No APK at $in was built or restored."; exit 1; }
zipalign=$(find "$ANDROID_HOME/build-tools" -name zipalign | sort | tail -1)
[ -n "$zipalign" ] || { echo "::error::No zipalign under $ANDROID_HOME/build-tools."; exit 1; }
apksigner="$(dirname "$zipalign")/apksigner"

work=$(mktemp -d)
mkdir -p "$work/assets"
cp "$bundle" "$work/assets/index.android.bundle"
cp "$in" "$work/unaligned.apk"
# Stored, as the template packs it: with `enableBundleCompression` false Hermes maps it in place.
(cd "$work" && zip -0 -q -X unaligned.apk assets/index.android.bundle)
"$zipalign" -p -f 4 "$work/unaligned.apk" "$out"
"$apksigner" sign --ks android/app/debug.keystore --ks-pass pass:android \
  --ks-key-alias androiddebugkey --key-pass pass:android "$out"
unzip -p "$out" assets/index.android.bundle | cmp - "$bundle"
