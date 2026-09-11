# Online Indicator

A GNOME Shell extension for Ubuntu that shows a colored sphere in the top bar
reflecting internet connectivity, based on periodic ICMP pings to a
configurable host.

| Icon      | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| 🟢 green  | 0% packet loss                                            |
| 🟠 orange | some packet loss, below the threshold                     |
| 🔴 red    | packet loss at or above the threshold, or no reply at all |
| ⚪ grey   | no result yet (just started)                              |

Click the icon for a status line, a 10-minute latency chart, and the recent
success rate.

## Requirements

- GNOME Shell 46 (Ubuntu 24.04).
- `/usr/bin/ping` (used for ICMP checks; needs `cap_net_raw`, which Ubuntu's
  `ping` has by default).

## Install (from source)

```sh
git clone <this repo>
cd gnome-online-indicator
make install
```

This symlinks the repo into
`~/.local/share/gnome-shell/extensions/gnome-online-indicator@maryayi` and
compiles the GSettings schema.

Then, on X11, reload the shell (`Alt+F2` → `r`) — or on Wayland, log out and
back in — so `gnome-shell` picks up the new extension, and enable it:

```sh
gnome-extensions enable gnome-online-indicator@maryayi
```

A grey sphere appears in the top bar immediately; it turns green, orange, or
red once the first ping check completes.

## Settings

```sh
gnome-extensions prefs gnome-online-indicator@maryayi
```

| Setting        | Default   | Description                                   |
| -------------- | --------- | --------------------------------------------- |
| Host           | `8.8.8.8` | Hostname or IP address to ping                |
| Interval       | 5 s       | Seconds between checks (2–300)                |
| Loss threshold | 50 %      | Packet loss at/above which the icon turns red |

Changes apply immediately, no reload needed.

## Packaging

```sh
make pack
```

Produces `gnome-online-indicator@maryayi.shell-extension.zip`, installable via
`gnome-extensions install <zip>` or the Extensions app.

## Development

See [AGENTS.md](AGENTS.md) for architecture notes, the code-reload workflow,
and gotchas (ping invocation, Cairo cleanup, import paths). See
[PLAN.md](PLAN.md) for the original spec and manual verification scenarios.
