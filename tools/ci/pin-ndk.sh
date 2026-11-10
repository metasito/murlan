#!/usr/bin/env bash
# Builds the generated android/ on the runner's newest NDK of the major React Native pins, which
# builds the same ABI, rather than the exact one Gradle would download on every build (a corrupt
# download failed run 33906255549). Line 1 of build.gradle is before the root plugins, applied at
# the end, read it. Run after `expo prebuild --platform android`, from the repo root.
set -euo pipefail

want=$(sed -n 's/^ndkVersion = "\(.*\)"$/\1/p' node_modules/react-native/gradle/libs.versions.toml)
have=$(ls "$ANDROID_HOME/ndk" | grep "^${want%%.*}\." | sort -V | tail -1 || true)
[ -n "$have" ] || { echo "::error::No NDK ${want%%.*}.x under $ANDROID_HOME/ndk to build with."; exit 1; }
sed -i "1i ext.ndkVersion = \"$have\"" android/build.gradle
[ -z "${GITHUB_OUTPUT:-}" ] || echo "ndk=$have" >> "$GITHUB_OUTPUT"
echo "Building with NDK $have (React Native pins $want)"
