#!/usr/bin/env bash
# Install or remove the Saved Networks applet for Cinnamon.
#   ./install.sh            copy the applet into place, swap out the stock network applet,
#                           and install the login check
#   ./install.sh --restore  put the stock network applet back and remove the login check
set -euo pipefail

UUID="saved-networks@local"
STOCK="network@cinnamon.org"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"
AUTOSTART="$HOME/.config/autostart/saved-networks-check.desktop"

enabled() { gsettings get org.cinnamon enabled-applets; }

swap() { # swap <from-uuid> <to-uuid>: rename the entry in place, keep its panel slot
    local list
    list="$(enabled)"
    if grep -q "$2" <<<"$list"; then
        return 0
    fi
    if ! grep -q "$1" <<<"$list"; then
        # not present at all: append to the right side of the first panel
        list="${list%]*}, 'panel1:right:7:$2:99']"
    else
        list="$(sed -E "s/(panel[0-9]+:(left|right|center):[0-9]+:)$1(:[0-9]+)/\1$2\3/" <<<"$list")"
    fi
    gsettings set org.cinnamon enabled-applets "$list"
}

if [[ "${1:-}" == "--restore" ]]; then
    swap "$UUID" "$STOCK"
    rm -f "$AUTOSTART"
    echo "Stock network applet restored."
    exit 0
fi

if [[ "$SRC" != "$DEST" ]]; then
    mkdir -p "$DEST"
    cp "$SRC"/metadata.json "$SRC"/applet.js "$SRC"/check.sh "$DEST"/
fi
chmod +x "$DEST/check.sh"

mkdir -p "$(dirname "$AUTOSTART")"
cat >"$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Saved Networks check
Comment=Warn if the Saved Networks applet is no longer in the panel
Exec=$DEST/check.sh
X-GNOME-Autostart-Delay=20
EOF

swap "$STOCK" "$UUID"
echo "Installed. Saved Networks is now the panel's network applet."
