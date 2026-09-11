# Online Indicator — Plan

A top bar icon for Ubuntu showing a colored sphere that reflects internet
connectivity, based on periodic ICMP pings to a configurable host.

## 1. Stack

**GNOME Shell extension, written in GJS (JavaScript, ES modules).**

- Ubuntu 24.04's desktop is GNOME Shell 46. Top bar items are GNOME Shell
  extensions — this is the native way (Ubuntu's own dock and AppIndicator
  support are extensions too).
- The extension's popup menu drops down below the icon and can hold custom
  widgets, so the chart fits right inside it.
- Rejected alternative: Python + AyatanaAppIndicator. AppIndicator menus are
  plain DBusMenu items — no way to embed a chart.
- Zero dependencies and no build step. Everything ships with Ubuntu:
  GJS, St/Clutter (UI), Cairo (chart), GSettings (config), libadwaita (settings window).
- ICMP via the system `/usr/bin/ping` run with `Gio.Subprocess`. Ubuntu's ping
  has `cap_net_raw`, so no root is needed. (Opening ICMP sockets directly isn't
  possible: `net.ipv4.ping_group_range = 1 0` disables unprivileged ICMP.)

Target: GNOME Shell 46 (Ubuntu 24.04 LTS).

## 2. Behavior

### Ping loop

- Every `interval` seconds (default **5**), run one check:
  ```
  LC_ALL=C ping -n -q -c 5 -i 0.2 -W 2 -- <host>
  ```
  A burst of 5 packets: ~1 s when healthy, ~3 s max when nothing answers.
  `LC_ALL=C` keeps output parseable; `--` stops the host being read as an option.
- Parse the summary lines:
  ```
  5 packets transmitted, 4 received, 20% packet loss, time 805ms
  rtt min/avg/max/mdev = 80.384/92.383/104.110/8.419 ms
  ```
  → sample `{ time, sent, received, avgRtt }`.
- If there is no summary (DNS failure → exit code 2, network down, …) the sample
  is `{ sent: 5, received: 0 }`.
- If the previous check is still running (e.g. slow DNS), skip the tick.
- Keep samples in memory for the last **10 minutes**; drop older ones.

### Status → icon color

Loss is taken from the **latest check**.

| Icon      | Condition                                                         |
|-----------|-------------------------------------------------------------------|
| 🟢 green  | 0 % loss                                                          |
| 🟠 orange | 0 % < loss < `loss-threshold` (default 50 %) — with 5 packets: 1–2 lost |
| 🔴 red    | loss ≥ `loss-threshold`, no reply at all, or ping error           |
| ⚪ grey   | no result yet (just started)                                      |

### Popup (click on the icon)

```
                         ( ● )   ← sphere in top bar
      ┌──────────────────────────────────┐
      │ Online · 8.8.8.8 · 23 ms         │  status line
      │ ▁▂▁▁▃▁▁▁█▁▁▂▁▁▁▁▁▁▁▂▁▁▁▁▁▁▁▁▁▁▁  │  chart, last 10 min
      │ −10 min                      now │
      │ Success rate (10 min): 99.2 %    │
      ├──────────────────────────────────┤
      │ Settings                         │
      │ About                            │
      └──────────────────────────────────┘
```

- **Chart**: one bar per check, placed by its timestamp (right edge = now).
  Bar height = avg RTT, scaled to the max RTT in the window (min scale 100 ms).
  Bar color = that check's status color. A check with no reply = full-height red bar.
- **Success rate** = Σ received / Σ sent over the last 10 min (packets, not
  checks). Shows `—` until there's data.
- **Settings** → opens the preferences window (`this.openPreferences()`).
- **About** → small modal dialog: name, version, one-line description, Close.

### Settings

GSettings schema `org.gnome.shell.extensions.online-indicator`:

| Key              | Type | Default     | Range      | Widget         |
|------------------|------|-------------|------------|----------------|
| `host`           | `s`  | `'8.8.8.8'` | —          | `Adw.EntryRow` |
| `interval`       | `i`  | `5`         | 2–300 s    | `Adw.SpinRow`  |
| `loss-threshold` | `i`  | `50`        | 1–100 %    | `Adw.SpinRow`  |

Changes apply live, no restart needed. The extension listens to `changed::*`
and restarts the timer. Changing `host` also clears history, since old samples
belong to another host. An empty host falls back to `8.8.8.8`.

## 3. Project layout

```
gnome-online-indicator/
├── metadata.json      # uuid, name, shell-version ["46"], settings-schema
├── extension.js       # enable/disable, panel button, popup, chart, About dialog
├── pinger.js          # run ping, parse output, keep 10-min history, stats (no UI)
├── prefs.js           # settings window (libadwaita)
├── stylesheet.css     # chart size, label spacing
├── schemas/
│   └── org.gnome.shell.extensions.online-indicator.gschema.xml
├── icons/
│   ├── sphere-green.svg
│   ├── sphere-orange.svg
│   ├── sphere-red.svg
│   └── sphere-grey.svg
├── Makefile           # install (dev symlink + compile schemas), pack (zip)
└── README.md
```

UUID: `online-indicator@mahdiaryayi` (easy to change before first install).

## 4. Implementation notes

- **pinger.js**:
  - `Pinger` class: `start(host, interval)`, `stop()`, and an `onSample(sample)`
    callback, run with `Gio.SubprocessLauncher` + `communicate_utf8_async`,
    plus a `Gio.Cancellable`.
  - Pure helpers: `parsePing(text)`, `statusOf(sample, threshold)`,
    `successRate(samples)`.
- **extension.js**:
  - `OnlineIndicator extends PanelMenu.Button`, with an `St.Icon`
    (`system-status-icon`) whose `gicon` swaps between the 4 SVGs.
  - The chart is an `St.DrawingArea` inside a non-reactive
    `PopupBaseMenuItem`, drawn with Cairo in its `repaint` handler
    (call `cr.$dispose()` at the end).
  - Repaint only while the menu is open: on open, and on each new sample
    while open.
- **Icons**: 16×16 SVG circles with a radial gradient (light highlight
  top-left → base color → darker rim) for a 3D sphere look. They're full-color
  files, not `-symbolic`, so the theme won't recolor them. Loaded with
  `Gio.FileIcon` from the extension dir.
- **About**: `ModalDialog.ModalDialog` + `Dialog.MessageDialogContent`.
- **Cleanup (GNOME review rules)**: `disable()` undoes everything `enable()` did:
  - remove the GLib timeout
  - cancel the running ping and `force_exit()` it
  - disconnect settings signals
  - destroy the indicator and null out references

  No work at import time.
- **History is in memory only**: it resets on shell restart, and on screen lock
  (GNOME disables extensions while locked). That's acceptable for v1.

## 5. Implementation steps (next phase)

1. Scaffold `metadata.json`, the schema and the `Makefile`. `make install`, then
   enable → a grey sphere appears in the top bar.
2. Draw the 4 sphere SVGs.
3. `pinger.js`: spawn, parse, history. Log samples to the journal to check them.
4. Wire status → icon color.
5. Popup: status line, chart, success rate, Settings, About.
6. `prefs.js` + live reload on settings change.
7. `README.md` (install/usage) + run the checks below.

## 6. Verification

- **Dev loop** (X11): `make install`, then `Alt+F2` → `r` to reload the shell,
  then `gnome-extensions enable online-indicator@mahdiaryayi`.
  Logs: `journalctl -f -o cat /usr/bin/gnome-shell`.
- **Green**: the default host `8.8.8.8` turns green within one interval.
- **Red**: host `192.0.2.1` (reserved TEST-NET, never answers) or
  `no-such-host.invalid` (DNS failure); or `nmcli networking off`.
- **Orange**: simulate loss with `sudo tc qdisc add dev <iface> root netem loss 25%`
  (undo: `sudo tc qdisc del dev <iface> root`).
- **Settings**: changing host / interval / threshold takes effect without a reload.
- **Cleanup**: toggle disable/enable a few times. Check for no journal errors
  and no leftover `ping` processes (`pgrep -a ping`).

## 7. Out of scope (v1)

Persisting history, notifications, latency-based coloring, multiple hosts,
translations, publishing to extensions.gnome.org. `make pack` will already
produce an uploadable zip if that's wanted later.
