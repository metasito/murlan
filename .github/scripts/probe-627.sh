#!/usr/bin/env bash
# DIAGNOSTIC ONLY - not for merge. #627.
#
# Drives the tutorial's Skip button with plain `adb shell input tap`, with no
# Maestro anywhere in the loop. Eleven runs have varied the app and the flow;
# none has asked whether the tap injection channel itself works. That is the
# split this answers:
#
#   adb tap dismisses the tutorial  -> the app is fine, Maestro's driver is not
#   adb tap does nothing, Back+tap works -> real app bug, reproducible without Maestro
#   neither works -> touch is dead at the window layer
set -u

PKG=host.exp.exponent
LINK='exp://127.0.0.1:8081?disableOnboarding=1'

say() { echo; echo "### $*"; }

dump() {
  adb shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1
  adb shell cat /sdcard/d.xml 2>/dev/null
}

say "display geometry"
adb shell wm size
adb shell wm density
adb shell dumpsys display | grep -E 'mDisplayWidth|mDisplayHeight|DisplayDeviceInfo' | head -5

say "cold start, state cleared"
adb shell pm clear "$PKG"
adb shell am start -W -a android.intent.action.VIEW -d "$LINK" "$PKG"

say "waiting for the tutorial (max 180s)"
found=""
for i in $(seq 1 90); do
  x=$(dump)
  case "$x" in
    *"GUIDA RAPIDA"*) found=tutorial; break ;;
    *"Gioca online"*) found=home; break ;;
  esac
  sleep 2
done
echo "after $((i * 2))s: ${found:-nothing}"
[ "$found" = tutorial ] || { echo "::error::Never reached the tutorial; probe cannot run."; exit 1; }

say "the Skip node, as the device itself reports it"
xml=$(dump)
node=$(echo "$xml" | tr '>' '\n' | grep 'Salta il tutorial' | head -1)
echo "$node"
bounds=$(echo "$node" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
echo "bounds: ${bounds:-NONE}"
[ -n "$bounds" ] || { echo "::error::Skip button is not in the hierarchy at all."; exit 1; }

nums=$(echo "$bounds" | grep -o '[0-9]*' | tr '\n' ' ')
set -- $nums
cx=$(( ($1 + $3) / 2 ))
cy=$(( ($2 + $4) / 2 ))
echo "centre: $cx $cy"

gone() { case "$(dump)" in *"GUIDA RAPIDA"*) return 1 ;; *) return 0 ;; esac; }

say "ATTEMPT 1 - plain adb tap, no key event has reached the app"
adb logcat -c
adb shell input tap "$cx" "$cy"
sleep 3
if gone; then echo "RESULT: adb tap WORKED. The app is fine; Maestro's injection is the bug."; exit 0; fi
echo "adb tap did nothing."

say "ATTEMPT 2 - a second adb tap, in case the first is always swallowed"
adb shell input tap "$cx" "$cy"
sleep 3
if gone; then echo "RESULT: the FIRST tap is swallowed, later taps land."; exit 0; fi
echo "second adb tap did nothing either."

say "ATTEMPT 3 - Back first, then tap (the correlation, without Maestro)"
adb shell input keyevent 4
sleep 2
case "$(dump)" in *"GUIDA RAPIDA"*) echo "still on the tutorial after Back" ;; *) echo "NOTE: Back itself left the tutorial" ;; esac
adb shell input tap "$cx" "$cy"
sleep 3
if gone; then echo "RESULT: Back unblocks touch. Real app bug, reproduced with zero Maestro."; else echo "RESULT: touch is dead even after Back."; fi

say "what the app saw"
adb logcat -d -t 400 | grep -iE 'ReactNative|Choreographer|InputDispatch|ANR|Screens|unhandled' | tail -60

say "window state at the end"
adb shell dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp|imeInputTarget'

say "hierarchy at the end"
dump | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | head -40
