# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

Online Indicator is a GNOME Shell extension written in GJS (JavaScript ES modules).
It shows a colored sphere in the Ubuntu top bar that reflects connectivity,
based on periodic ICMP pings to a configurable host. The target is GNOME Shell 46 /
Ubuntu 24.04. The dev machine runs an X11 session.

**Status:** implemented and packaged for extensions.gnome.org (GNOME Shell 46
only). `PLAN.md` is the spec. Keep it simple: no dependencies, no build step,
no npm/TypeScript.

## Commands

UUID: `online-indicator@maryayi.github.io`

```sh
make install     # symlink repo into ~/.local/share/gnome-shell/extensions/<uuid> + compile schemas
make pack        # gnome-extensions pack → uploadable zip
glib-compile-schemas schemas/                          # after every .gschema.xml edit
gnome-extensions enable online-indicator@maryayi.github.io
gnome-extensions prefs online-indicator@maryayi.github.io    # open the settings window
journalctl -f -o cat /usr/bin/gnome-shell              # extension logs and JS errors
```

**Reloading code:** GNOME 45+ caches ES modules, so disabling and re-enabling
does **not** pick up changes to `extension.js` or `pinger.js`. Restart the shell
instead:

- X11: `Alt+F2` → `r`.
- Wayland: log out, or test in `dbus-run-session -- gnome-shell --nested --wayland`.

A newly installed extension also needs a shell restart before
`gnome-extensions` can see it.

**Tests:** there is no automated test suite. Verify by hand with the
scenarios in PLAN.md §6 (pick a host that gives each color, or use `tc netem`).
`pinger.js` has no Shell imports, so its pure helpers (`parsePing`, `statusOf`,
`successRate`) can be run under plain `gjs -m`.

## Architecture

There are two processes, linked only through GSettings.

- **`extension.js`** runs inside `gnome-shell`.
  - `enable()` creates the panel button (`PanelMenu.Button`), the `Pinger` and
    the settings listeners.
  - `disable()` must undo all of it: remove the GLib timeout, cancel the running
    ping and `force_exit()` it, disconnect signals, destroy actors, null out
    references.
  - Do no work at module import time. These are extensions.gnome.org review rules.
- **`pinger.js`** has no UI. Each tick spawns `/usr/bin/ping` via
  `Gio.SubprocessLauncher`, parses the summary, adds a
  `{time, sent, received, avgRtt}` sample to a 10-minute in-memory history,
  then fires the `onSample` callback.
  - `extension.js` maps the latest sample to an icon with
    `statusOf(sample, loss-threshold)`.
  - It repaints the chart (Cairo on an `St.DrawingArea`) only while the menu is open.
- **`prefs.js`** runs in a **separate process** (libadwaita) and only writes
  GSettings. `extension.js` reacts through `changed::` signals: it restarts the
  timer, and a host change also clears history.
  - Never import Shell modules (`St`, `Main`, `resource:///org/gnome/shell/...`)
    in `prefs.js`, and never import Gtk/Adw in `extension.js`.

**Shared contract:** the GSettings schema
`org.gnome.shell.extensions.online-indicator` in `schemas/`, with keys `host`,
`interval` and `loss-threshold`. Adding or changing a key means updating the
schema, `prefs.js` and `extension.js` together, then recompiling the schema.

## Gotchas

- **ICMP:** send it through `/usr/bin/ping`, which has `cap_net_raw`.
  Unprivileged ICMP sockets are disabled here (`net.ipv4.ping_group_range = 1 0`),
  so Gio sockets won't work.
- **Spawning ping:**
  - Always set `LC_ALL=C`, because ping's output is localized.
  - Put `--` before the host, so a host like `-f` isn't parsed as an option.
  - Output that can't be parsed (e.g. a DNS failure, exit code 2) counts as
    100 % loss.
  - Never run overlapping pings: skip a tick if one is still running.
- **Icons:** the sphere icons are full-color SVGs, loaded with `Gio.FileIcon`
  from the extension dir. Don't name them `-symbolic`, or the theme recolors them.
- **Cairo:** in `repaint` handlers, call `cr.$dispose()` at the end, or the
  context leaks.
- **Imports:** use GNOME 45+ ESM paths, e.g. `gi://Gio` and
  `resource:///org/gnome/shell/ui/panelMenu.js`. `prefs.js` imports from
  `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`.
