#!/bin/bash
# Installs Organic into your user plug-in folders. Double-click it (the first
# time: right-click > Open, because it isn't from the App Store).
set -e
here="$(cd "$(dirname "$0")" && pwd)"
vst3="$HOME/Library/Audio/Plug-Ins/VST3"
au="$HOME/Library/Audio/Plug-Ins/Components"
mkdir -p "$vst3" "$au"

rm -rf "$vst3/Organic.vst3" "$au/Organic MIDI FX.component"
cp -R "$here/Organic.vst3" "$vst3/"
cp -R "$here/Organic MIDI FX.component" "$au/"
xattr -dr com.apple.quarantine "$vst3/Organic.vst3" "$au/Organic MIDI FX.component" 2>/dev/null || true
# Make Logic and other AU hosts notice the new component.
killall -9 AudioComponentRegistrar 2>/dev/null || true

echo
echo "Installed:"
echo "  $vst3/Organic.vst3"
echo "  $au/Organic MIDI FX.component"
echo
echo "Restart Ableton Live (or Settings > Plug-Ins > Rescan). See INSTALL.txt for routing."
echo "You can close this window."
