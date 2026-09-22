#!/usr/bin/env bash
# Rebuilds the JS inside a built Release .app: `usage: rebundle-ios-app.sh <path/to/App.app>`.
# It runs the same react-native-xcode.sh, with the same environment, as the
# "Bundle React Native code and images" phase expo prebuild writes into the Xcode project.
set -euo pipefail

app="$(cd "$1" && pwd)"
node_binary="$(command -v node)"

rm -f "$app/main.jsbundle"
CONFIGURATION=Release \
PLATFORM_NAME=iphonesimulator \
CONFIGURATION_BUILD_DIR="$(dirname "$app")" \
UNLOCALIZED_RESOURCES_FOLDER_PATH="$(basename "$app")" \
PROJECT_ROOT="$PWD" \
PODS_ROOT="$PWD/ios/Pods" \
NODE_BINARY="$node_binary" \
ENTRY_FILE="$("$node_binary" -e "require('expo/scripts/resolveAppEntry')" "$PWD" ios absolute | tail -n 1)" \
CLI_PATH="$("$node_binary" --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")" \
BUNDLE_COMMAND=export:embed \
HERMES_CLI_PATH="$("$node_binary" --print "require('path').dirname(require.resolve('hermes-compiler/package.json'))")/hermesc/osx-bin/hermesc" \
  bash "$("$node_binary" --print "require('path').dirname(require.resolve('react-native/package.json'))")/scripts/react-native-xcode.sh"

[ -s "$app/main.jsbundle" ] || { echo "::error::$app has no main.jsbundle after rebundling."; exit 1; }
