# Saved Networks (Cinnamon applet)

A network applet for Cinnamon that lists **only networks you have saved**. Nearby networks are
never scanned or shown, so a stray click can't put you on someone's open hotspot.

- Saved Wi-Fi, Wired, VPN and everything else (VLAN, …) in one menu; click to connect or disconnect
- Saved profiles without encryption are flagged `⚠ open` and ask for confirmation before connecting
- **Discover unknown networks** switch: off by default, never remembered, warns when turned on,
  switches itself off after 5 minutes or after you connect
- Enterprise (802.1X) and WEP networks are handed to Network Settings

## Install

Clone the repo anywhere and run the installer:

```bash
git clone <this repo> && cd cinnamon-saved-networks
./install.sh
```

It asks for an applet name (default `local`, so the applet id becomes `saved-networks@local`),
copies the applet into `~/.local/share/cinnamon/applets/`, swaps it in for the stock
`network@cinnamon.org` applet (same panel slot), and adds a login check to your autostart.
The check shows a critical notification if the applet ever stops being enabled or its files
disappear.

Options: `--id NAME` skips the question, `--no-autostart` skips the login check, and
`--restore` puts the stock applet back and removes the login check.

## Notes

- The stock applet is also Cinnamon's secret agent for password prompts. This applet asks for
  new Wi-Fi passwords itself; passwords of saved profiles are stored in the profile and keep working.
- A new network's password is briefly visible in the process list while `nmcli` saves it.
