#!/usr/bin/env bash
set -euo pipefail

APK_PATH=${1:?APK path is required}
PACKAGE=ir.majora.classicbag
DB=majora_shopSQLite.db
SDK_MANAGER="${ANDROID_HOME:?ANDROID_HOME is missing}/cmdline-tools/latest/bin/sdkmanager"
AVD_MANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
IMAGE='system-images;android-35;default;x86_64'

test -s "$APK_PATH"
if [[ ! -x "$SDK_MANAGER" || ! -x "$AVD_MANAGER" ]]; then
  echo "Android SDK command-line tools are missing under $ANDROID_HOME" >&2
  exit 1
fi
if [[ ! -c /dev/kvm ]]; then
  echo 'GitHub runner has no /dev/kvm device; accelerated emulator unavailable.' >&2
  exit 1
fi
sudo chmod 666 /dev/kvm

"$SDK_MANAGER" --install emulator "$IMAGE"
EMULATOR="$ANDROID_HOME/emulator/emulator"
test -x "$EMULATOR"
export ANDROID_AVD_HOME="$RUNNER_TEMP/majora-avd"
mkdir -p "$ANDROID_AVD_HOME"
echo no | "$AVD_MANAGER" create avd -n majora-smoke -k "$IMAGE" --force

"$EMULATOR" -avd majora-smoke -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -accel on -no-snapshot -memory 2048 -cores 2 \
  > "$RUNNER_TEMP/majora-emulator.log" 2>&1 &
EMULATOR_PID=$!
trap 'kill "$EMULATOR_PID" 2>/dev/null || true' EXIT

adb wait-for-device
for attempt in $(seq 1 120); do
  if [[ $(adb shell getprop sys.boot_completed | tr -d '\r') == 1 ]]; then break; fi
  sleep 3
done
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1
adb install -r "$APK_PATH"
adb shell am start -n "$PACKAGE/.MainActivity"

for attempt in $(seq 1 60); do
  if adb shell run-as "$PACKAGE" ls "databases/$DB" >/dev/null 2>&1; then break; fi
  sleep 2
done
adb shell run-as "$PACKAGE" ls -l "databases/$DB"
for attempt in $(seq 1 20); do
  sleep 3
  rm -f "$RUNNER_TEMP/$DB-wal" "$RUNNER_TEMP/$DB-shm"
  adb exec-out run-as "$PACKAGE" cat "databases/$DB" > "$RUNNER_TEMP/$DB"
  if adb shell run-as "$PACKAGE" ls "databases/$DB-wal" >/dev/null 2>&1; then
    adb exec-out run-as "$PACKAGE" cat "databases/$DB-wal" > "$RUNNER_TEMP/$DB-wal"
  fi
  status=$(sqlite3 "$RUNNER_TEMP/$DB" "SELECT (SELECT count(*) FROM sqlite_master WHERE type='table' AND name='invoice'),(SELECT count(*) FROM store WHERE id='classic-bag-belt'),(SELECT count(*) FROM template_version);" 2>/dev/null || true)
  if [[ "$status" =~ ^1\|1\|[1-9][0-9]*$ ]] && [[ $(sqlite3 "$RUNNER_TEMP/$DB" 'PRAGMA integrity_check;') == ok ]]; then
    echo "Android emulator smoke passed after attempt $attempt: schema, store, template and integrity verified."
    exit 0
  fi
done
echo "Android emulator smoke failed: last database status was '${status:-unavailable}'." >&2
adb shell run-as "$PACKAGE" ls -l databases >&2 || true
ls -l "$RUNNER_TEMP/$DB"* >&2 || true
adb logcat -d -t 400 | grep -E 'Capacitor|SQLite|majora|AndroidRuntime' | tail -100 >&2 || true
exit 1
