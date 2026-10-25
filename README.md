# Saved Networks (Cinnamon applet)

A network applet for Cinnamon that lists **only networks you have saved**. Nearby networks are
never scanned or shown, so a stray click can't put you on someone's open hotspot.

- Saved Wi-Fi, Wired, VPN and everything else (VLAN, …) in one menu; click to connect or disconnect
- Saved profiles without encryption are flagged `⚠ open` and ask for confirmation before connecting
- **Discover unknown networks** switch: off by default, never remembered, warns when turned on,
  switches itself off after 5 minutes or after you connect
- Enterprise (802.1X) and WEP networks are handed to Network Settings

## Install

```bash
git clone <this repo> ~/.local/share/cinnamon/applets/saved-networks@local
~/.local/share/cinnamon/applets/saved-networks@local/install.sh
```

`install.sh` swaps the stock `network@cinnamon.org` applet for this one (same panel slot) and adds
a login check (`check.sh`) that shows a critical notification if the applet ever stops being
enabled or its files disappear.

Go back to the stock applet with `./install.sh --restore`.

## Notes

- The stock applet is also Cinnamon's secret agent for password prompts. This applet asks for
  new Wi-Fi passwords itself; passwords of saved profiles are stored in the profile and keep working.
- A new network's password is briefly visible in the process list while `nmcli` saves it.
