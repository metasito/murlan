#!/usr/bin/env bash
# DIAGNOSTIC ONLY - not for merge. #627.
#
# A tap at the Skip button's own device-reported centre leaves the app and
# lands on the Android launcher. Two things do that, and they need opposite
# fixes:
#
#   (a) the tap misses - bounds and injection are in different coordinate
#       spaces (rotation), so it hits something outside the app
#   (b) the tap lands and the app dies - Skip crashes it, and the launcher is
#       just what is behind the corpse
#
# So: record the rotation and the process id before, and check whether that
# same process is still alive after. Nothing here is inferred from the screen.
set -u

PKG=host.exp.exponent
LINK='exp://127.0.0.1:8081?disableOnboarding=1'
SHOT="$HOME/.maestro/tests/probe"
mkdir -p "$SHOT"

say() { echo; echo "### $*"; }
dump() { adb shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb shell cat /sdcard/d.xml 2>/dev/null; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
labels() { dump | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | tr '\n' ' '; echo; }
pid() { adb shell pidof "$PKG" 2>/dev/null | tr -d '\r'; }
geom() { echo "  rotation=$(adb shell dumpsys window displays 2>/dev/null | grep -oE 'cur=[0-9]+x[0-9]+|rotation=[A-Z_0-9]+' | tr '\n' ' ')  wm=$(adb shell wm size | tr -d '\r')  pid=$(pid)"; }

say "cold start, state cleared"
adb shell pm clear "$PKG"
adb shell am start -W -a android.intent.action.VIEW -d "$LINK" "$PKG" | grep -E 'Status|TotalTime'

say "sampling the launch to a 300s deadline"
deadline=$(( $(date +%s) + 300 ))
xml=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  x=$(dump)
  if has "$x" "GUIDA RAPIDA"; then xml=$x; break; fi
  # Say what IS on screen, every time. A wait that reports only the absence of
  # what it wanted is how the previous four runs each cost 10 minutes and
  # answered nothing.
  echo "  t+$(( 300 - (deadline - $(date +%s)) ))s pid=$(pid) :: $(printf '%s' "$x" | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | tr '\n' ' ' | cut -c1-220)"
done
if [ -z "$xml" ]; then
  echo "::error::Never reached the tutorial in 300s. State at give-up:"
  geom
  echo "  metro /status: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8081/status)"
  adb logcat -d -t 300 2>/dev/null | grep -iE 'FATAL|AndroidRuntime|ReactNative|Expo|bundl' | tail -30
  exit 1
fi
echo "on the tutorial."

say "geometry and process, BEFORE the tap"
geom
before=$(pid)
adb exec-out screencap -p > "$SHOT/1-tutorial.png" 2>/dev/null; echo "  screenshot: $(wc -c < "$SHOT/1-tutorial.png") bytes"

# Is the whole screen dead to touch, or only the header? "Inizia" sits in the
# card body, "Salta il tutorial" and "Indietro" sit in the header above it.
# Tapping one of each localises it without a single line of reasoning.
tap_by_desc() {
  d=$(dump)
  n=$(printf '%s' "$d" | tr '>' '\n' | grep "content-desc=\"$1\"" | head -1)
  set -- $(printf '%s' "$n" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9][0-9]*' | tr '\n' ' ')
  [ $# -eq 4 ] || { echo "  not found"; return 1; }
  echo "  tapping ($(( ($1+$3)/2 )), $(( ($2+$4)/2 )))"
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
  sleep 3
}
step() { dump | grep -oE 'text="[0-9]+ / [0-9]+"' | head -1; }

say "LOCALISING - body control vs header control"
echo "step before:      $(step)"
echo "tap BODY 'Inizia':";        tap_by_desc "Inizia"
echo "step after body:  $(step)   <- changed means the body takes touch"
echo "tap HEADER 'Salta il tutorial':"; tap_by_desc "Salta il tutorial"
echo "still on tutorial? $(dump | grep -c 'GUIDA RAPIDA\|Benvenuto a Murlan') (0 means Skip fired)"
echo "on screen now: $(labels)"

say "the Skip node as the device reports it"
node=$(printf '%s' "$xml" | tr '>' '\n' | grep 'content-desc="Salta il tutorial"' | head -1)
echo "$node"
set -- $(printf '%s' "$node" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9][0-9]*' | tr '\n' ' ')
cx=$(( ($1 + $3) / 2 )); cy=$(( ($2 + $4) / 2 ))
echo "centre: $cx $cy"

say "TAP at $cx $cy"
adb logcat -c
adb shell input tap "$cx" "$cy"
sleep 4
after=$(pid)
echo "  pid before=$before  after=${after:-DEAD}"
geom
adb exec-out screencap -p > "$SHOT/2-after-tap.png" 2>/dev/null; echo "  screenshot: $(wc -c < "$SHOT/2-after-tap.png") bytes"
echo "  on screen: $(labels)"

say "VERDICT"
if [ -z "$after" ]; then
  echo "(b) THE APP DIED. The tap landed and killed it - this is a crash, not a miss."
elif [ "$before" != "$after" ]; then
  echo "(b) THE APP RESTARTED ($before -> $after). It died and Expo Go came back."
else
  echo "(a) The app is ALIVE and the same process. The tap did not reach the button - a miss, not a crash."
fi

say "logcat around the tap"
adb logcat -d -t 600 2>/dev/null | grep -iE 'FATAL|AndroidRuntime|tombstone|SIGSEGV|libc|ReactNative|ExceptionsManager|died|ActivityTaskManager.*host.exp' | tail -40

say "activity stack now"
adb shell dumpsys activity activities 2>/dev/null | grep -E 'mResumedActivity|topResumedActivity' | head -5

exit 1
