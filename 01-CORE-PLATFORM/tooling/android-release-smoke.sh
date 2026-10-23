#!/usr/bin/env bash
set -euo pipefail

APK_PATH=${1:?Signed APK path is required}
PACKAGE=ir.majora.classicbag
SDK_MANAGER="${ANDROID_HOME:?ANDROID_HOME is missing}/cmdline-tools/latest/bin/sdkmanager"
AVD_MANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
IMAGE='system-images;android-35;default;x86_64'

test -s "$APK_PATH"
test -x "$SDK_MANAGER"
test -x "$AVD_MANAGER"
test -c /dev/kvm
sudo chmod 666 /dev/kvm
"$SDK_MANAGER" --install emulator "$IMAGE"
export ANDROID_AVD_HOME="$RUNNER_TEMP/majora-release-avd"
mkdir -p "$ANDROID_AVD_HOME"
echo no | "$AVD_MANAGER" create avd -n majora-release -k "$IMAGE" --force
"$ANDROID_HOME/emulator/emulator" -avd majora-release -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -accel on -no-snapshot -memory 2048 -cores 2 \
  > "$RUNNER_TEMP/majora-release-emulator.log" 2>&1 &
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

for attempt in $(seq 1 40); do
  if adb shell pidof "$PACKAGE" >/dev/null 2>&1; then break; fi
  sleep 2
done
adb shell pidof "$PACKAGE"
sleep 5
adb shell pidof "$PACKAGE"
adb exec-out screencap -p > "$RUNNER_TEMP/majora-release-home.png"
test -s "$RUNNER_TEMP/majora-release-home.png"
if adb logcat -d -t 1200 | grep -A 5 -E 'FATAL EXCEPTION|Process: ir\.majora\.classicbag.*has died' | grep -q 'ir.majora.classicbag'; then
  echo 'Release APK crashed after launch' >&2
  exit 1
fi
echo 'Signed release APK installed and remained running on Android 35 emulator.'
