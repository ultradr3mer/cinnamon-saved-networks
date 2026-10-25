#!/usr/bin/env bash
# Runs at login. If the Saved Networks applet is no longer enabled (panel reset, settings
# wipe, Cinnamon dropping a broken applet), say so loudly instead of silently showing the
# stock menu, which lists every nearby network. The applet id is this folder's name.
DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
UUID="$(basename "$DIR")"

if ! gsettings get org.cinnamon enabled-applets | grep -q "$UUID"; then
    notify-send -u critical -i dialog-warning "Saved Networks applet is not active" \
        "Your panel is not using the saved-networks-only menu. Run $DIR/install.sh to bring it back."
elif [[ ! -f "$DIR/applet.js" ]]; then
    notify-send -u critical -i dialog-warning "Saved Networks applet is missing" \
        "$DIR/applet.js is gone. Restore it from the git repository."
fi
