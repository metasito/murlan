#!/usr/bin/env bash
# DIAGNOSTIC ONLY - not for merge. #627.
#
# Nine hypotheses have been eliminated by device runs. This one tests none of
# them. It records what is actually there, in a state known dead and a state
# known live, and prints both so the difference is read rather than guessed.
#
# Why it can see something every previous probe could not:
#
#   `uiautomator dump` renders the ACCESSIBILITY tree. A view that sets
#   importantForAccessibility="no-hide-descendants" is absent from it while
#   remaining fully touchable. Every "nothing covers the button" statement on
#   this ticket rests on that dump, so an a11y-hidden overlay would have been
#   invisible to all of them, and so would a transparent one to the
#   byte-identical screenshots.
#
#   `dumpsys activity top` renders the real VIEW hierarchy. Nothing hides from
#   it.
#
# The second measurement is the window's touchable region. If the app window's
# region is intact in the dead state, touch is being consumed inside the view
# tree; if it is shrunk or empty, the window is not being offered the touch at
# all. Those are different bugs with different owners.
#
# Both states come from one run so nothing about the machine differs between
# them: the tutorial the launch effect pushed (dead), then home after Back
# (live). The comparison is the point - a hierarchy on its own says nothing.
set -u

PKG=host.exp.exponent
LINK='exp://127.0.0.1:8081?disableOnboarding=1'
OUT="$HOME/.maestro/tests/probe"
mkdir -p "$OUT"

say() { echo; echo "### $*"; }
dump() { adb shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb shell cat /sdcard/d.xml 2>/dev/null; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
labels() { dump | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | tr '\n' ' '; echo; }
pid() { adb shell pidof "$PKG" 2>/dev/null | tr -d '\r'; }
step() { dump | grep -oE 'text="[0-9]+ / [0-9]+"' | head -1; }

# The real view tree for the resumed activity. Everything from the DecorView
# down, whether or not it carries semantics.
views() { adb shell dumpsys activity top 2>/dev/null | sed -n '/View Hierarchy/,/^$/p'; }

# What the window manager will actually deliver touch to.
region() {
  adb shell dumpsys window windows 2>/dev/null |
    grep -E 'Window\{|mTouchableRegion|touchable region|mHasSurface|mObscured|isReadyForDisplay|mViewVisibility|flags=' |
    sed 's/^ *//'
}

capture() { # capture <name>
  echo "--- views: $1 ---"
  views | tee "$OUT/views-$1.txt" | sed -n '1,200p'
  echo "--- view count: $(views | grep -c . ) lines, $(views | grep -cE '^\s*[A-Za-z_$.]+\{' ) view nodes ---"
  echo "--- window/region: $1 ---"
  region | tee "$OUT/region-$1.txt"
}

say "cold start, state cleared"
adb shell pm clear "$PKG"
adb shell am start -W -a android.intent.action.VIEW -d "$LINK" "$PKG" | grep -E 'Status|TotalTime'

say "waiting for the launch-pushed tutorial (300s deadline)"
deadline=$(( $(date +%s) + 300 ))
xml=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  x=$(dump)
  if has "$x" "GUIDA RAPIDA"; then xml=$x; break; fi
  echo "  t+$(( 300 - (deadline - $(date +%s)) ))s pid=$(pid) :: $(printf '%s' "$x" | tr '>' '\n' | grep -oE '(text|content-desc)="[^"]+"' | sort -u | tr '\n' ' ' | cut -c1-200)"
done
[ -n "$xml" ] || { echo "::error::never reached the tutorial"; exit 1; }
echo "on the tutorial. pid=$(pid)"

say "STATE A - the tutorial the launch effect pushed (expected DEAD to touch)"
capture "A-tutorial-dead"

say "confirming A really is dead"
echo "step before: $(step)"
node=$(printf '%s' "$xml" | tr '>' '\n' | grep 'content-desc="Inizia"' | head -1)
set -- $(printf '%s' "$node" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9][0-9]*' | tr '\n' ' ')
if [ $# -eq 4 ]; then
  bx=$(( ($1 + $3) / 2 )); by=$(( ($2 + $4) / 2 ))
  echo "tapping Inizia at ($bx, $by)"
  adb shell input tap "$bx" "$by"; sleep 3
  echo "step after:  $(step)   <- unchanged means dead, as every previous run found"
else
  echo "  Inizia not found in the dump"
fi

say "leaving the screen: Back"
adb shell input keyevent KEYCODE_BACK
sleep 4
echo "on screen now: $(labels)"

say "STATE B - home, same process, known LIVE to touch"
echo "pid=$(pid)  (same pid as above means we never restarted)"
capture "B-home-live"

say "confirming B really is live"
before_labels=$(labels)
snode=$(dump | tr '>' '\n' | grep -E 'content-desc="(Impostazioni|Settings)"' | head -1)
set -- $(printf '%s' "$snode" | grep -o 'bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' | head -1 | grep -o '[0-9][0-9]*' | tr '\n' ' ')
if [ $# -eq 4 ]; then
  echo "tapping Settings at ($(( ($1+$3)/2 )), $(( ($2+$4)/2 )))"
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); sleep 3
  echo "on screen after: $(labels)"
  echo "  ^ a settings panel here is the positive control: touch works in this process"
else
  echo "  Settings control not found; labels were: $before_labels"
fi

say "THE ANSWER - what state A has that state B does not"
diff "$OUT/views-A-tutorial-dead.txt" "$OUT/views-B-home-live.txt" > "$OUT/views.diff" || true
echo "view-hierarchy diff (A dead vs B live), $(wc -l < "$OUT/views.diff") lines:"
sed -n '1,300p' "$OUT/views.diff"

echo
echo "touchable-region diff:"
diff "$OUT/region-A-tutorial-dead.txt" "$OUT/region-B-home-live.txt" || true

say "how to read this"
cat <<'EOF'
  A view present in A and absent in B, sized like the screen  -> something covers the
      tutorial. It is a11y-hidden (or it would have shown in every previous dump) and
      transparent (or the screenshots would have differed). That is our code or Expo Go's,
      and it is findable by class name.
  Hierarchies effectively identical, regions identical        -> nothing covers it and the
      window is being offered the touch. The loss is inside React Native's own dispatch,
      and the next measurement is the JS side, not the native tree.
  Region in A shrunken, empty, or a different window on top   -> the window manager is not
      delivering to the app at all, which is a different bug with a different owner.
EOF
exit 0
