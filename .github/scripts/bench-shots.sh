#!/bin/sh
# Waits for the bench run recorded in $1 to end, taking a screenshot beside it for each `shot` row as the row
# lands: from the Android emulator, or the iOS simulator $SIMULATOR_UDID, as $2 names. Each screenshot taken
# is acknowledged on :5098, where the scenario waits for it before its state moves on. Gives up after
# $WAIT_SECONDS of the clock, and fails for a shot the scenario stopped waiting for.
record=$1
platform=$2
out=$(dirname "$record")
acks="$out/acks"
mkdir -p "$acks"
python3 -m http.server 5098 --bind 127.0.0.1 --directory "$acks" > "$out/ack-server.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null' EXIT
fail() {
  echo "::error::$1"
  exit 1
}
taken=" "
deadline=$(($(date +%s) + WAIT_SECONDS))
ended=false
until $ended; do
  grep -q '"k":"run".*"phase":"end"' "$record" 2>/dev/null && ended=true
  for id in $(grep -o '"k":"shot"[^}]*' "$record" 2>/dev/null | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'); do
    case "$taken" in *" $id "*) continue ;; esac
    seen=$(date +%s)
    if [ "$platform" = android ]; then
      adb exec-out screencap -p > "$out/$id.png"
    else
      xcrun simctl io "$SIMULATOR_UDID" screenshot "$out/$id.png" > /dev/null 2>&1
    fi
    : > "$acks/$id"
    echo "$id took $(($(date +%s) - seen))s" >> "$out/shots.txt"
    taken="$taken$id "
  done
  $ended && break
  [ "$(date +%s)" -lt "$deadline" ] || fail "The scenario never ended."
  sleep 1
done
late=""
for id in $taken; do
  grep -q "\"k\":\"shotAcked\"[^}]*\"id\":\"$id\",\"acked\":true" "$record" || late="$late $id"
done
[ -z "$late" ] || fail "Screenshots taken after their state had gone:$late"
