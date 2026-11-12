#!/bin/sh
# Waits for the bench run recorded in $1 to end, taking a screenshot beside it for each `shot` row as the row
# lands: from the Android emulator, or the iOS simulator $SIMULATOR_UDID, as $2 names. Gives up after
# $WAIT_SECONDS. Writes `ok`, or why not, to shots-status beside the record, for a caller that started it in
# the background.
record=$1
platform=$2
out=$(dirname "$record")
status="$out/shots-status"
rm -f "$status"
fail() {
  echo "::error::$1"
  echo "$1" > "$status"
  exit 1
}
taken=" "
late=""
i=0
ended=false
until $ended; do
  # Read before the shots, so a shot whose row lands with the run's end is still taken, and known late.
  grep -q '"k":"run".*"phase":"end"' "$record" 2>/dev/null && ended=true
  fresh=0
  for id in $(grep -o '"k":"shot"[^}]*' "$record" 2>/dev/null | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'); do
    case "$taken" in *" $id "*) continue ;; esac
    # The scenario holds each shot for longer than a poll, so a second new one in a poll means the first was taken late.
    fresh=$((fresh + 1))
    if [ "$fresh" -gt 1 ] || $ended; then late="$late $id"; fi
    if [ "$platform" = android ]; then
      adb exec-out screencap -p > "$out/$id.png"
    else
      xcrun simctl io "$SIMULATOR_UDID" screenshot "$out/$id.png" > /dev/null 2>&1
    fi
    taken="$taken$id "
  done
  $ended && break
  i=$((i + 1))
  [ "$i" -lt "$WAIT_SECONDS" ] || fail "The scenario never ended."
  sleep 1
done
[ -z "$late" ] || fail "Screenshots taken after their state had gone:$late"
echo ok > "$status"
