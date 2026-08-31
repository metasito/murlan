#!/usr/bin/env bash
# DIAGNOSTIC ONLY - not for merge. #627.
#
# Drives one button with plain `adb shell input tap`, with no Maestro anywhere
# in the loop. Eleven runs have varied the app and the flow; none has asked
# whether the tap injection channel itself works. That is the split this
# answers:
#
#   adb tap lands              -> the app is fine, Maestro's driver is not
#   only Back-then-tap lands   -> real app bug, reproducible without Maestro
#   neither lands              -> touch is dead at the window layer
set -u

PKG=host.exp.exponent
LINK='exp://127.0.0.1:8081?disableOnboarding=1'

say() { echo; echo "### $*"; }
dump() { adb shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb shell cat /sdcard/d.xml 2>/dev/null; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# Centre of the first node carrying this content-desc, as "x y".
centre() {
  n=$(printf '%s' "$1" | tr '>' '\n' | grep "content-desc=\"$2\"" | head -1)
  b=$(printf '%s' "$n" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1)
  [ -n "$b" ] || return 1
  set -- $(printf '%s' "$b" | grep -o '[0-9][0-9]*' | tr '\n' ' ')
  echo "$(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))"
}

labels() { dump | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | tr '\n' ' '; echo; }

say "display geometry"
adb shell wm size; adb shell wm density

say "cold start, state cleared"
adb shell pm clear "$PKG"
adb shell am start -W -a android.intent.action.VIEW -d "$LINK" "$PKG"

# The tutorial is pushed by an effect *after* home has already rendered, so
# "home is up" is not the end of the launch. Keep sampling to a wall-clock
# deadline and prefer the tutorial if it ever arrives.
say "sampling the launch to a 180s deadline"
deadline=$(( $(date +%s) + 180 ))
screen=""; xml=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  x=$(dump)
  if has "$x" "GUIDA RAPIDA"; then screen=tutorial; xml=$x; break; fi
  if has "$x" "Gioca online"; then screen=home; xml=$x; fi
  echo "  t+$(( 180 - (deadline - $(date +%s)) ))s: ${screen:-nothing yet}"
done
echo "settled on: ${screen:-nothing}"
[ -n "$screen" ] || { echo "::error::The app never rendered; probe cannot run."; exit 1; }

# Whatever is on screen, tap one real control and look for the change it causes.
if [ "$screen" = tutorial ]; then
  target="Salta il tutorial"; check_gone="GUIDA RAPIDA"; check_here=""
else
  target="Impostazioni";      check_gone="";            check_here="Volume"
fi
say "target: $target  (on the $screen screen)"

xy=$(centre "$xml" "$target") || { echo "::error::'$target' is not in the hierarchy."; printf '%s' "$xml" | tr '>' '\n' | grep -o 'content-desc="[^"]*"' | sort -u; exit 1; }
echo "centre: $xy"

landed() {
  d=$(dump)
  [ -z "$check_here" ] || { has "$d" "$check_here" && return 0; return 1; }
  has "$d" "$check_gone" && return 1
  return 0
}

say "ATTEMPT 1 - plain adb tap, no key event has reached the app"
adb logcat -c
adb shell input tap $xy
sleep 3
echo "--- on screen after tap 1 ---"; labels
if landed; then echo "RESULT: adb tap WORKED."; exit 0; fi
echo "the Skip button did not fire."

say "ATTEMPT 2 - a second adb tap, in case the first is always swallowed"
adb shell input tap $xy
sleep 3
echo "--- on screen after tap 2 ---"; labels
if landed; then echo "RESULT: the FIRST tap is swallowed, later taps land."; exit 0; fi
echo "the Skip button did not fire."

say "ATTEMPT 3 - Back first, then tap (the correlation, without Maestro)"
adb shell input keyevent 4
sleep 3
echo "--- after Back alone, before any tap ---"; labels
if landed; then echo "NOTE: Back ALONE left the tutorial, so attempt 3 tests nothing about touch."; fi
adb shell input tap $xy
sleep 3
echo "--- after Back then tap ---"; labels

say "what the app saw"
adb logcat -d -t 400 | grep -iE 'ReactNative|InputDispatch|ANR|Screens|unhandled|DevMenu' | tail -50

say "window state at the end"
adb shell dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp|imeInputTarget'

say "every label on screen at the end"
dump | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | head -50
