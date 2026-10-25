#!/usr/bin/env bash
# Install or remove the Saved Networks applet for Cinnamon.
#
#   ./install.sh                 asks for an applet name, copies the applet into place, swaps it in
#                                for the stock network applet, and adds a login check to autostart
#   ./install.sh --id NAME       same, without asking (applet id becomes saved-networks@NAME)
#   ./install.sh --no-autostart  skip the login check
#   ./install.sh --restore       put the stock network applet back and remove the login check
#
# Test overrides: APPLETS_DIR, AUTOSTART_DIR, and --no-panel (leave the panel settings alone).
set -euo pipefail

PREFIX="saved-networks"
STOCK="network@cinnamon.org"
DEFAULT_NAME="local"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLETS_DIR="${APPLETS_DIR:-$HOME/.local/share/cinnamon/applets}"
AUTOSTART="${AUTOSTART_DIR:-$HOME/.config/autostart}/saved-networks-check.desktop"

name="" restore=0 autostart=1 panel=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --id) name="${2:?--id needs a name}"; shift ;;
        --restore) restore=1 ;;
        --no-autostart) autostart=0 ;;
        --no-panel) panel=0 ;;
        -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

enabled() { gsettings get org.cinnamon enabled-applets; }
installed_uuid() { enabled | grep -o "$PREFIX@[A-Za-z0-9._-]*" | head -1 || true; }

# swap FROM TO: rename the panel entry in place so the applet keeps its slot.
swap() {
    [[ $panel -eq 1 ]] || return 0
    local list
    list="$(enabled)"
    grep -q "'[^']*:$2:[0-9]*'" <<<"$list" && return 0
    if grep -q "$1" <<<"$list"; then
        list="$(sed -E "s/(panel[0-9]+:(left|right|center):[0-9]+:)$1(:[0-9]+)/\1$2\3/" <<<"$list")"
    else
        list="${list%]*}, 'panel1:right:7:$2:99']"
    fi
    gsettings set org.cinnamon enabled-applets "$list"
}

if [[ $restore -eq 1 ]]; then
    from="$(installed_uuid)"
    [[ -n "$from" ]] && swap "$from" "$STOCK"
    rm -f "$AUTOSTART"
    echo "Stock network applet restored."
    exit 0
fi

# Running from inside the applets folder: the folder name already is the id.
if [[ "$(dirname "$SRC")" == "$APPLETS_DIR" ]]; then
    uuid="$(basename "$SRC")"
    name="${uuid#"$PREFIX"@}"
    sed -E -i "s/\"uuid\": *\"[^\"]*\"/\"uuid\": \"$uuid\"/" "$SRC/metadata.json"
else
    if [[ -z "$name" ]]; then
        read -r -p "Applet name (becomes $PREFIX@NAME) [$DEFAULT_NAME]: " name
        name="${name:-$DEFAULT_NAME}"
    fi
    if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
        echo "Name may only contain letters, digits, '.', '_' and '-'." >&2
        exit 2
    fi
    uuid="$PREFIX@$name"
fi
dest="$APPLETS_DIR/$uuid"

if [[ "$SRC" != "$dest" ]]; then
    mkdir -p "$dest"
    cp "$SRC"/applet.js "$SRC"/check.sh "$dest"/
    sed -E "s/\"uuid\": *\"[^\"]*\"/\"uuid\": \"$uuid\"/" "$SRC/metadata.json" >"$dest/metadata.json"
fi
chmod +x "$dest/check.sh"

if [[ $autostart -eq 1 ]]; then
    mkdir -p "$(dirname "$AUTOSTART")"
    cat >"$AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Saved Networks check
Comment=Warn if the Saved Networks applet is no longer in the panel
Exec=$dest/check.sh
X-GNOME-Autostart-Delay=20
EOF
fi

from="$(installed_uuid)"
swap "${from:-$STOCK}" "$uuid"
echo "Installed $uuid in $dest"
[[ $autostart -eq 1 ]] && echo "Login check added: $AUTOSTART"
exit 0
