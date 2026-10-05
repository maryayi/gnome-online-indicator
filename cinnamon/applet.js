const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const St = imports.gi.St;

const { Pinger, statusOf, successRate } = require('./pinger');

const HISTORY_WINDOW_MS = 10 * 60 * 1000;
const MIN_RTT_SCALE_MS = 100;
const DEFAULT_HOST = '8.8.8.8';

const ICON_FILES = {
    green: 'sphere-green.svg',
    orange: 'sphere-orange.svg',
    red: 'sphere-red.svg',
    grey: 'sphere-grey.svg',
};

const STATUS_LABELS = {
    green: 'Online',
    orange: 'Degraded',
    red: 'Offline',
    grey: 'Checking…',
};

const CHART_COLORS = {
    green: [0.18, 0.75, 0.35],
    orange: [0.91, 0.55, 0.05],
    red: [0.85, 0.25, 0.18],
    grey: [0.6, 0.63, 0.64],
};

class OnlineIndicatorApplet extends Applet.IconApplet {
    constructor(metadata, orientation, panelHeight, instanceId) {
        super(orientation, panelHeight, instanceId);

        this._dir = metadata.path;
        this._pinger = new Pinger();
        this._latestSample = null;

        this._setIcon('grey');
        this.set_applet_tooltip('Online Indicator');

        // Settings are bound to this._host, this._interval and this._lossThreshold.
        this._settings = new Settings.AppletSettings(this, metadata.uuid, instanceId);
        this._settings.bind('host', '_host', () => {
            this._pinger.clearHistory();
            this._restartPinger();
        });
        this._settings.bind('interval', '_interval', () => this._restartPinger());
        this._settings.bind('loss-threshold', '_lossThreshold', () => this._restartPinger());

        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this._menuManager.addMenu(this.menu);
        this._buildMenu();

        this.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this._repaintChart();
        });

        this._pinger.onSample = sample => this._onSample(sample);
        this._restartPinger();
    }

    _buildMenu() {
        this._statusItem = new PopupMenu.PopupMenuItem('Checking…', { reactive: false });
        this.menu.addMenuItem(this._statusItem);

        const chartItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        this._chartArea = new St.DrawingArea({ style_class: 'online-indicator-chart' });
        this._chartArea.connect('repaint', area => this._onRepaint(area));
        chartItem.addActor(this._chartArea, { span: -1, expand: true });
        this.menu.addMenuItem(chartItem);

        const rangeItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        const rangeBox = new St.BoxLayout({ x_expand: true });
        rangeBox.add_child(new St.Label({
            text: '−10 min',
            style_class: 'online-indicator-range-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        }));
        rangeBox.add_child(new St.Label({
            text: 'now',
            style_class: 'online-indicator-range-label',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        }));
        rangeItem.addActor(rangeBox, { span: -1, expand: true });
        this.menu.addMenuItem(rangeItem);

        this._rateItem = new PopupMenu.PopupMenuItem('Success rate (10 min): —', { reactive: false });
        this.menu.addMenuItem(this._rateItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => this.configureApplet());
        this.menu.addMenuItem(settingsItem);

        const aboutItem = new PopupMenu.PopupMenuItem('About');
        aboutItem.connect('activate', () => this.openAbout());
        this.menu.addMenuItem(aboutItem);
    }

    _hostOrDefault() {
        return this._host || DEFAULT_HOST;
    }

    _restartPinger() {
        this._pinger.start(this._hostOrDefault(), this._interval);
    }

    _onSample(sample) {
        this._latestSample = sample;

        const status = statusOf(sample, this._lossThreshold);
        this._setIcon(status);
        this._updateLabels(status, sample);

        if (this.menu.isOpen)
            this._repaintChart();
    }

    _setIcon(status) {
        this.set_applet_icon_path(`${this._dir}/icons/${ICON_FILES[status]}`);
        this._applyIconSize();
    }

    // The spheres are full-color, but sized like the symbolic status icons
    // next to them rather than the (larger) full-color panel icon size.
    _applyIconSize() {
        const size = this.getPanelIconSize(St.IconType.SYMBOLIC);
        if (size && this._applet_icon)
            this._applet_icon.set_icon_size(size);
    }

    on_panel_height_changed() {
        this._applyIconSize();
    }

    _updateLabels(status, sample) {
        let text = `${STATUS_LABELS[status]} · ${this._hostOrDefault()}`;
        if (sample.avgRtt !== undefined)
            text += ` · ${Math.round(sample.avgRtt)} ms`;
        this._statusItem.setLabel(text);
        this.set_applet_tooltip(text);

        const rate = successRate(this._windowedHistory());
        this._rateItem.setLabel(rate === null
            ? 'Success rate (10 min): —'
            : `Success rate (10 min): ${(rate * 100).toFixed(1)} %`);
    }

    _windowedHistory() {
        const cutoff = Date.now() - HISTORY_WINDOW_MS;
        return this._pinger.history.filter(s => s.time >= cutoff);
    }

    _repaintChart() {
        if (this._chartArea)
            this._chartArea.queue_repaint();
    }

    _onRepaint(area) {
        const [width, height] = area.get_surface_size();
        const cr = area.get_context();

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);

        const samples = this._windowedHistory();

        if (samples.length === 0) {
            cr.$dispose();
            return;
        }

        let maxRtt = MIN_RTT_SCALE_MS;
        for (const sample of samples) {
            if (sample.avgRtt !== undefined && sample.avgRtt > maxRtt)
                maxRtt = sample.avgRtt;
        }

        const now = Date.now();
        const barWidth = 3;

        for (const sample of samples) {
            const age = now - sample.time;
            const x = width - (age / HISTORY_WINDOW_MS) * width;

            const status = statusOf(sample, this._lossThreshold);
            const heightFrac = sample.avgRtt !== undefined
                ? Math.min(1, sample.avgRtt / maxRtt)
                : 1;
            const barHeight = Math.max(1, heightFrac * height);
            const [r, g, b] = CHART_COLORS[status];

            cr.setSourceRGB(r, g, b);
            cr.rectangle(x - barWidth / 2, height - barHeight, barWidth, barHeight);
            cr.fill();
        }

        cr.$dispose();
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._pinger.onSample = null;
        this._pinger.stop();
        this._pinger = null;

        this._settings.finalize();
        this._settings = null;

        this.menu.destroy();
        this._chartArea = null;
    }
}

function main(metadata, orientation, panelHeight, instanceId) {
    return new OnlineIndicatorApplet(metadata, orientation, panelHeight, instanceId);
}
