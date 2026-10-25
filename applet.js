const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const POLL_SECONDS = 5;
const DISCOVER_TIMEOUT_SECONDS = 300;
const MAX_NEARBY = 12;

// Profile types that are plumbing (Docker bridges, Tailscale, loopback), not
// something the user connects to by hand. Everything else gets listed.
const HIDDEN_TYPES = ["bridge", "loopback", "tun", "tap", "dummy", "veth", "bridge-slave"];
const WIFI = "802-11-wireless";
const WIRED = "802-3-ethernet";
const VPN_TYPES = ["vpn", "wireguard"];

function spawn(argv, callback, wantStdout = true) {
    try {
        const proc = new Gio.Subprocess({
            argv: argv,
            flags: (wantStdout ? Gio.SubprocessFlags.STDOUT_PIPE : Gio.SubprocessFlags.STDOUT_SILENCE) |
                Gio.SubprocessFlags.STDERR_SILENCE
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                callback(out || "", p.get_exit_status());
            } catch (e) {
                global.logError(e);
                callback("", 1);
            }
        });
    } catch (e) {
        global.logError(e);
        callback("", 1);
    }
}

// nmcli -t escapes ':' and '\' inside values with a backslash.
function splitTerse(line) {
    const out = [];
    let cur = "";
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "\\" && i + 1 < line.length) {
            cur += line[++i];
        } else if (c === ":") {
            out.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
}

function confirm(text, callback) {
    spawn(["zenity", "--question", "--icon-name=dialog-warning", "--no-markup",
        "--title=Network warning", "--ok-label=Continue", "--cancel-label=Cancel",
        "--width=420", "--text=" + text],
        (out, status) => callback(status === 0), false);
}

function askPassword(ssid, callback) {
    spawn(["zenity", "--password", "--title=Wi-Fi password: " + ssid],
        (out, status) => callback(status === 0 ? out.replace(/\n$/, "") : null));
}

class SavedNetworksApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);
        this.set_applet_icon_symbolic_name("network-offline-symbolic");
        this.set_applet_tooltip("Saved networks");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.connections = [];
        this.wifiEnabled = true;
        this.wifiInfo = {};       // uuid -> {ssid, secured}, cached
        this.nearby = [];
        this.discover = false;    // never persisted: off after every login
        this.discoverTimer = 0;
        this.refreshing = false;
        this.timeoutId = 0;

        this.refresh(() => {});
        this.timeoutId = Mainloop.timeout_add_seconds(POLL_SECONDS, () => {
            if (!this.menu.isOpen)
                this.refresh(() => {});
            return true;
        });
    }

    on_applet_clicked() {
        if (this.menu.isOpen) {
            this.menu.close();
            return;
        }
        this.refresh(() => this.menu.open());
    }

    on_applet_removed_from_panel() {
        if (this.timeoutId)
            Mainloop.source_remove(this.timeoutId);
        this.timeoutId = 0;
        this.stopDiscover();
    }

    // ---- state ----------------------------------------------------------

    refresh(done) {
        if (this.refreshing) {
            done();
            return;
        }
        this.refreshing = true;
        spawn(["nmcli", "-t", "-f", "NAME,UUID,TYPE,DEVICE", "connection", "show"], (out) => {
            this.connections = out.split("\n").filter(l => l).map(l => {
                const [name, uuid, type, device] = splitTerse(l);
                return {name, uuid, type, active: !!device && device !== "--"};
            }).filter(c => !HIDDEN_TYPES.includes(c.type));

            spawn(["nmcli", "radio", "wifi"], (state) => {
                this.wifiEnabled = state.trim() === "enabled";
                this.loadWifiInfo(() => this.loadNearby(() => {
                    this.refreshing = false;
                    this.updateIcon();
                    this.rebuildMenu();
                    done();
                }));
            });
        });
    }

    // SSID and whether the saved Wi-Fi profile uses any key management.
    loadWifiInfo(done) {
        const todo = this.connections.filter(c => c.type === WIFI && !(c.uuid in this.wifiInfo));
        if (todo.length === 0) {
            done();
            return;
        }
        let pending = todo.length;
        todo.forEach(c => {
            spawn(["nmcli", "-g", "802-11-wireless.ssid,802-11-wireless-security.key-mgmt",
                "connection", "show", "uuid", c.uuid], (out) => {
                const [ssid, keyMgmt] = out.split("\n");
                this.wifiInfo[c.uuid] = {ssid: ssid || c.name, secured: !!(keyMgmt && keyMgmt.trim())};
                if (--pending === 0)
                    done();
            });
        });
    }

    // Only runs while Discover is on; this is the only place that scans.
    loadNearby(done) {
        if (!this.discover || !this.wifiEnabled) {
            this.nearby = [];
            done();
            return;
        }
        spawn(["nmcli", "-t", "-f", "SSID,SECURITY,SIGNAL", "device", "wifi", "list", "--rescan", "auto"], (out) => {
            const saved = new Set(Object.values(this.wifiInfo).map(i => i.ssid));
            const best = {};
            out.split("\n").filter(l => l).forEach(l => {
                const [ssid, security, signal] = splitTerse(l);
                if (!ssid || saved.has(ssid))
                    return;
                const sig = parseInt(signal) || 0;
                if (!(ssid in best) || best[ssid].signal < sig)
                    best[ssid] = {ssid, security: security === "--" ? "" : security, signal: sig};
            });
            this.nearby = Object.values(best).sort((a, b) => b.signal - a.signal).slice(0, MAX_NEARBY);
            done();
        });
    }

    updateIcon() {
        const activeOf = (...types) => this.connections.find(c => c.active && types.includes(c.type));
        const wifi = activeOf(WIFI);
        const wired = activeOf(WIRED);
        const vpn = activeOf(...VPN_TYPES);
        let icon = "network-offline-symbolic";
        let tip = "Not connected";
        if (wifi) {
            const open = this.wifiInfo[wifi.uuid] && !this.wifiInfo[wifi.uuid].secured;
            icon = open ? "security-low-symbolic" : "network-wireless-signal-good-symbolic";
            tip = wifi.name + (open ? " (OPEN, unencrypted)" : "");
        } else if (wired) {
            icon = "network-wired-symbolic";
            tip = wired.name;
        }
        if (vpn)
            tip += " + " + vpn.name;
        if (this.discover)
            tip += " [discover on]";
        this.set_applet_icon_symbolic_name(icon);
        this.set_applet_tooltip(tip);
    }

    // ---- actions --------------------------------------------------------

    toggle(c) {
        const up = () => spawn(["nmcli", "connection", c.active ? "down" : "up", "uuid", c.uuid],
            () => this.refresh(() => {}), false);
        const info = this.wifiInfo[c.uuid];
        if (!c.active && c.type === WIFI && info && !info.secured) {
            confirm("\"" + c.name + "\" has no encryption. Everyone nearby can read what you send over it " +
                "unless it is protected another way (HTTPS only, VPN).\n\nConnect anyway?",
                ok => { if (ok) up(); });
        } else {
            up();
        }
    }

    connectUnknown(n) {
        const isOpen = n.security === "";
        const isEnterprise = n.security.indexOf("802.1X") !== -1;
        const isWep = n.security.indexOf("WEP") !== -1;
        if (isEnterprise || isWep) {
            Main.notify("Saved Networks", "\"" + n.ssid + "\" needs manual setup (" + n.security +
                "). Opening Network Settings.");
            GLib.spawn_command_line_async("cinnamon-settings network");
            return;
        }
        const proceed = (password) => {
            const argv = ["nmcli", "connection", "add", "type", "wifi", "con-name", n.ssid, "ifname", "*",
                "ssid", n.ssid, "connection.autoconnect", "no"];
            if (!isOpen) {
                const sae = n.security.indexOf("WPA3") !== -1 && n.security.indexOf("WPA2") === -1;
                argv.push("wifi-sec.key-mgmt", sae ? "sae" : "wpa-psk", "wifi-sec.psk", password);
            }
            spawn(argv, (out, status) => {
                if (status !== 0) {
                    Main.notify("Saved Networks", "Could not create a profile for \"" + n.ssid + "\".");
                    return;
                }
                spawn(["nmcli", "connection", "up", "id", n.ssid], (o, st) => {
                    if (st === 0) {
                        this.stopDiscover();
                    } else {
                        Main.notify("Saved Networks", "Could not connect to \"" + n.ssid + "\". Wrong password?");
                        spawn(["nmcli", "connection", "delete", "id", n.ssid], () => {}, false);
                    }
                    this.refresh(() => {});
                }, false);
            }, false);
        };
        if (isOpen) {
            confirm("\"" + n.ssid + "\" is an OPEN network: no password, no encryption. Anyone nearby can " +
                "read your traffic, and the network name proves nothing (anyone can create a hotspot " +
                "with a familiar name).\n\nConnect anyway?",
                ok => { if (ok) proceed(null); });
        } else {
            askPassword(n.ssid, pw => { if (pw) proceed(pw); });
        }
    }

    startDiscover() {
        confirm("Discover lists Wi-Fi networks you have never saved.\n\nA hotspot can pretend to be a " +
            "network you know, and open ones are not encrypted. It turns itself off after 5 minutes " +
            "or after you connect.\n\nTurn Discover on?",
            ok => {
                if (ok) {
                    this.discover = true;
                    this.discoverTimer = Mainloop.timeout_add_seconds(DISCOVER_TIMEOUT_SECONDS, () => {
                        this.discoverTimer = 0;
                        this.stopDiscover();
                        return false;
                    });
                }
                this.refresh(() => {
                    if (!this.menu.isOpen)
                        this.menu.open();
                });
            });
    }

    stopDiscover() {
        this.discover = false;
        this.nearby = [];
        if (this.discoverTimer)
            Mainloop.source_remove(this.discoverTimer);
        this.discoverTimer = 0;
        this.refresh(() => {});
    }

    // ---- menu -----------------------------------------------------------

    addSection(title, items) {
        if (items.length === 0)
            return;
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(title));
        items.forEach(c => {
            let label = (c.active ? "● " : "    ") + c.name;
            const info = this.wifiInfo[c.uuid];
            if (c.type === WIFI && info && !info.secured)
                label += "  ⚠ open";
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect("activate", () => this.toggle(c));
            this.menu.addMenuItem(item);
        });
    }

    rebuildMenu() {
        this.menu.removeAll();

        const wifiSwitch = new PopupMenu.PopupSwitchMenuItem("Wi-Fi", this.wifiEnabled);
        wifiSwitch.connect("toggled", (item, state) => {
            spawn(["nmcli", "radio", "wifi", state ? "on" : "off"], () => this.refresh(() => {}), false);
        });
        this.menu.addMenuItem(wifiSwitch);

        const ofType = (...types) => this.connections.filter(c => types.includes(c.type));
        const known = [WIFI, WIRED, ...VPN_TYPES];
        this.addSection("Wi-Fi (saved only)", ofType(WIFI));
        this.addSection("Wired", ofType(WIRED));
        this.addSection("VPN", ofType(...VPN_TYPES));
        this.addSection("Other (VLAN, …)", this.connections.filter(c => !known.includes(c.type)));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const discoverSwitch = new PopupMenu.PopupSwitchMenuItem("Discover unknown networks ⚠", this.discover);
        discoverSwitch.connect("toggled", (item, state) => {
            if (state)
                this.startDiscover();
            else
                this.stopDiscover();
        });
        this.menu.addMenuItem(discoverSwitch);

        if (this.discover) {
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem("Nearby, never saved"));
            if (this.nearby.length === 0) {
                const none = new PopupMenu.PopupMenuItem("    nothing found", {reactive: false});
                this.menu.addMenuItem(none);
            }
            this.nearby.forEach(n => {
                const tag = n.security === "" ? "⚠ open" : n.security;
                const item = new PopupMenu.PopupMenuItem("    " + n.ssid + "   " + tag + "   " + n.signal + "%");
                item.connect("activate", () => this.connectUnknown(n));
                this.menu.addMenuItem(item);
            });
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupMenuItem("Network Settings…");
        settings.connect("activate", () => GLib.spawn_command_line_async("cinnamon-settings network"));
        this.menu.addMenuItem(settings);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new SavedNetworksApplet(metadata, orientation, panelHeight, instanceId);
}
