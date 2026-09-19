import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Cairo from 'gi://cairo';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';

import { Pinger, statusOf, successRate } from './pinger.js';

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

const OnlineIndicator = GObject.registerClass(
class OnlineIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Online Indicator');
        this.add_style_class_name('online-indicator-button');

        this._extension = extension;
        this._settings = extension.getSettings();
        this._pinger = new Pinger();
        this._latestSample = null;
        this._aboutDialog = null;

        this._icon = new St.Icon({ style_class: 'system-status-icon online-indicator-icon' });
        this.add_child(this._icon);
        this._setIcon('grey');

        this._buildMenu();

        this._pinger.onSample = sample => this._onSample(sample);

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'host')
                this._pinger.clearHistory();
            this._restartPinger();
        });

        this._menuOpenId = this.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this._repaintChart();
        });

        this._restartPinger();
    }

    _buildMenu() {
        this._statusItem = new PopupMenu.PopupMenuItem('Checking…', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._statusItem);

        const chartItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._chartArea = new St.DrawingArea({
            style_class: 'online-indicator-chart',
            x_expand: true,
        });
        this._chartArea.connect('repaint', area => this._onRepaint(area));
        chartItem.add_child(this._chartArea);
        this.menu.addMenuItem(chartItem);

        const rangeItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
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
        rangeItem.add_child(rangeBox);
        this.menu.addMenuItem(rangeItem);

        this._rateItem = new PopupMenu.PopupMenuItem('Success rate (10 min): —', {
            reactive: false,
            can_focus: false,
        });
        this.menu.addMenuItem(this._rateItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);

        const aboutItem = new PopupMenu.PopupMenuItem('About');
        aboutItem.connect('activate', () => this._showAbout());
        this.menu.addMenuItem(aboutItem);
    }

    _restartPinger() {
        const host = this._settings.get_string('host') || DEFAULT_HOST;
        const interval = this._settings.get_int('interval');
        this._pinger.start(host, interval);
    }

    _onSample(sample) {
        this._latestSample = sample;

        const threshold = this._settings.get_int('loss-threshold');
        const status = statusOf(sample, threshold);
        this._setIcon(status);
        this._updateLabels(status, sample);

        if (this.menu.isOpen)
            this._repaintChart();
    }

    _setIcon(status) {
        const file = this._extension.dir.get_child('icons').get_child(ICON_FILES[status]);
        this._icon.gicon = new Gio.FileIcon({ file });
    }

    _updateLabels(status, sample) {
        const host = this._settings.get_string('host') || DEFAULT_HOST;
        let text = `${STATUS_LABELS[status]} · ${host}`;
        if (sample.avgRtt !== undefined)
            text += ` · ${Math.round(sample.avgRtt)} ms`;
        this._statusItem.label.text = text;

        const rate = successRate(this._windowedHistory());
        this._rateItem.label.text = rate === null
            ? 'Success rate (10 min): —'
            : `Success rate (10 min): ${(rate * 100).toFixed(1)} %`;
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

        const threshold = this._settings.get_int('loss-threshold');
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

            const status = statusOf(sample, threshold);
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

    _showAbout() {
        this.menu.close();

        const dialog = new ModalDialog.ModalDialog({
            styleClass: 'online-indicator-about-dialog',
        });

        const content = new Dialog.MessageDialogContent({
            title: 'Online Indicator',
            description: `Version ${this._extension.metadata['version-name'] ?? '?'} — shows connectivity status in the top bar, based on periodic pings to a configurable host.`,
        });
        dialog.contentLayout.add_child(content);

        dialog.setButtons([
            {
                label: 'Close',
                action: () => dialog.close(),
                default: true,
            },
        ]);

        this._aboutDialog = dialog;
        dialog.connect('closed', () => {
            this._aboutDialog = null;
        });

        dialog.open();
    }

    destroy() {
        this._pinger.onSample = null;
        this._pinger.stop();
        this._pinger = null;

        if (this._aboutDialog) {
            this._aboutDialog.destroy();
            this._aboutDialog = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = null;
        }
        this._settings = null;
        this._extension = null;

        super.destroy();
    }
});

export default class OnlineIndicatorExtension extends Extension {
    enable() {
        this._indicator = new OnlineIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
