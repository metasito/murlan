#!/bin/sh
# Waits for the bench run recorded in $1 to end, taking a screenshot beside it for each `shot` row as the row
# lands: from the Android emulator, or the iOS simulator $SIMULATOR_UDID, as $2 names. Gives up after
# $WAIT_SECONDS.
record=$1
platform=$2
out=$(dirname "$record")
taken=" "
i=0
until grep -q '"k":"run".*"phase":"end"' "$record" 2>/dev/null; do
  for id in $(grep -o '"k":"shot"[^}]*' "$record" 2>/dev/null | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'); do
    case "$taken" in *" $id "*) continue ;; esac
    if [ "$platform" = android ]; then
      adb exec-out screencap -p > "$out/$id.png"
    else
      xcrun simctl io "$SIMULATOR_UDID" screenshot "$out/$id.png" > /dev/null 2>&1
    fi
    taken="$taken$id "
  done
  i=$((i + 1))
  [ "$i" -lt "$WAIT_SECONDS" ] || { echo "::error::The scenario never ended."; exit 1; }
  sleep 1
done
