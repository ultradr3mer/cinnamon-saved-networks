const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const POLL_SECONDS = 5;

function run(argv, callback) {
    try {
        const proc = new Gio.Subprocess({
            argv: argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, out] = p.communicate_utf8_finish(res);
                callback(out || "");
            } catch (e) {
                global.logError(e);
                callback("");
            }
        });
    } catch (e) {
        global.logError(e);
        callback("");
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
        this.secured = {}; // uuid -> true/false, cached
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
    }

    refresh(done) {
        if (this.refreshing) {
            done();
            return;
        }
        this.refreshing = true;
        run(["nmcli", "-t", "-f", "NAME,UUID,TYPE,DEVICE", "connection", "show"], (out) => {
            this.connections = out.split("\n").filter(l => l).map(l => {
                const [name, uuid, type, device] = splitTerse(l);
                return {name, uuid, type, active: !!device && device !== "--"};
            }).filter(c => ["802-11-wireless", "802-3-ethernet", "vpn", "wireguard"].includes(c.type));

            run(["nmcli", "radio", "wifi"], (state) => {
                this.wifiEnabled = state.trim() === "enabled";
                this.loadSecurity(() => {
                    this.refreshing = false;
                    this.updateIcon();
                    this.rebuildMenu();
                    done();
                });
            });
        });
    }

    // Open (no key-management) saved Wi-Fi profiles get flagged. Cached per uuid.
    loadSecurity(done) {
        const todo = this.connections.filter(c => c.type === "802-11-wireless" && !(c.uuid in this.secured));
        if (todo.length === 0) {
            done();
            return;
        }
        let pending = todo.length;
        todo.forEach(c => {
            run(["nmcli", "-g", "802-11-wireless-security.key-mgmt", "connection", "show", "uuid", c.uuid], (km) => {
                this.secured[c.uuid] = km.trim() !== "";
                if (--pending === 0)
                    done();
            });
        });
    }

    updateIcon() {
        const active = t => this.connections.some(c => c.active && c.type === t);
        let icon = "network-offline-symbolic";
        let tip = "Not connected";
        if (active("802-11-wireless")) {
            icon = "network-wireless-signal-good-symbolic";
            tip = this.connections.find(c => c.active && c.type === "802-11-wireless").name;
        } else if (active("802-3-ethernet")) {
            icon = "network-wired-symbolic";
            tip = this.connections.find(c => c.active && c.type === "802-3-ethernet").name;
        }
        if (active("vpn") || active("wireguard"))
            tip += " (VPN)";
        this.set_applet_icon_symbolic_name(icon);
        this.set_applet_tooltip(tip);
    }

    toggle(c) {
        const verb = c.active ? "down" : "up";
        run(["nmcli", "connection", verb, "uuid", c.uuid], () => this.refresh(() => {}));
    }

    addSection(title, items) {
        if (items.length === 0)
            return;
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(title));
        items.forEach(c => {
            let label = (c.active ? "● " : "    ") + c.name;
            if (c.type === "802-11-wireless" && this.secured[c.uuid] === false)
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
            run(["nmcli", "radio", "wifi", state ? "on" : "off"], () => this.refresh(() => {}));
        });
        this.menu.addMenuItem(wifiSwitch);

        const byType = (...types) => this.connections.filter(c => types.includes(c.type));
        this.addSection("Wi-Fi (saved only)", byType("802-11-wireless"));
        this.addSection("Wired", byType("802-3-ethernet"));
        this.addSection("VPN", byType("vpn", "wireguard"));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settings = new PopupMenu.PopupMenuItem("Network Settings…");
        settings.connect("activate", () => {
            GLib.spawn_command_line_async("cinnamon-settings network");
        });
        this.menu.addMenuItem(settings);
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new SavedNetworksApplet(metadata, orientation, panelHeight, instanceId);
}
