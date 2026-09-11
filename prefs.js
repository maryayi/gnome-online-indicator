import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OnlineIndicatorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({ title: 'Connectivity check' });
        page.add(group);

        const hostRow = new Adw.EntryRow({ title: 'Host' });
        settings.bind('host', hostRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(hostRow);

        const intervalRow = new Adw.SpinRow({
            title: 'Interval',
            subtitle: 'Seconds between checks',
            adjustment: new Gtk.Adjustment({ lower: 2, upper: 300, step_increment: 1 }),
        });
        settings.bind('interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(intervalRow);

        const thresholdRow = new Adw.SpinRow({
            title: 'Loss threshold',
            subtitle: 'Packet loss %, from the latest check, at or above which the indicator turns red',
            adjustment: new Gtk.Adjustment({ lower: 1, upper: 100, step_increment: 1 }),
        });
        settings.bind('loss-threshold', thresholdRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(thresholdRow);
    }
}
