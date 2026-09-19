import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const PING_COUNT = 5;
const PING_PACKET_INTERVAL = '0.2';
const PING_TIMEOUT = '2';
const HISTORY_WINDOW_MS = 10 * 60 * 1000;
const DEBUG = false;

/**
 * Parse the summary output of `ping -n -q -c N`.
 * Returns { sent, received, avgRtt }, with avgRtt omitted if there was no
 * rtt line (e.g. 100% loss). If the output has no parseable summary at all
 * (DNS failure, network down, ...), the check counts as a full loss.
 */
export function parsePing(text) {
    const summary = text.match(/(\d+) packets transmitted, (\d+) (?:packets )?received/);
    if (!summary)
        return { sent: PING_COUNT, received: 0 };

    const sent = parseInt(summary[1], 10);
    const received = parseInt(summary[2], 10);

    const rtt = text.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+\/[\d.]+/);
    if (rtt)
        return { sent, received, avgRtt: parseFloat(rtt[1]) };

    return { sent, received };
}

/** Map a sample to one of 'green' | 'orange' | 'red' | 'grey'. */
export function statusOf(sample, lossThreshold) {
    if (!sample || sample.sent === 0)
        return 'grey';

    const loss = 100 * (1 - sample.received / sample.sent);

    if (sample.received === 0 || loss >= lossThreshold)
        return 'red';
    if (loss > 0)
        return 'orange';
    return 'green';
}

/** Σ received / Σ sent over the given samples, or null if there is no data. */
export function successRate(samples) {
    let sent = 0;
    let received = 0;

    for (const sample of samples) {
        sent += sample.sent;
        received += sample.received;
    }

    if (sent === 0)
        return null;

    return received / sent;
}

export class Pinger {
    constructor() {
        this._history = [];
        this._host = null;
        this._timeoutId = null;
        this._cancellable = null;
        this._subprocess = null;
        this._checkInFlight = false;
        this.onSample = null;
    }

    get history() {
        return this._history;
    }

    start(host, intervalSeconds) {
        this.stop();

        this._host = host;

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSeconds, () => {
            this._check();
            return GLib.SOURCE_CONTINUE;
        });

        this._check();
    }

    stop() {
        if (this._timeoutId !== null) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._subprocess) {
            this._subprocess.force_exit();
            this._subprocess = null;
        }

        this._checkInFlight = false;
    }

    clearHistory() {
        this._history = [];
    }

    _check() {
        if (this._checkInFlight)
            return;
        this._checkInFlight = true;

        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        launcher.setenv('LC_ALL', 'C', true);

        this._cancellable = new Gio.Cancellable();

        let subprocess;
        try {
            subprocess = launcher.spawnv([
                '/usr/bin/ping', '-n', '-q',
                '-c', String(PING_COUNT),
                '-i', PING_PACKET_INTERVAL,
                '-W', PING_TIMEOUT,
                '--', this._host,
            ]);
        } catch (e) {
            this._checkInFlight = false;
            this._addSample({ sent: PING_COUNT, received: 0 });
            return;
        }

        this._subprocess = subprocess;

        subprocess.communicate_utf8_async(null, this._cancellable, (proc, result) => {
            this._checkInFlight = false;
            this._subprocess = null;

            let sample;
            try {
                const [, stdout] = proc.communicate_utf8_finish(result);
                sample = parsePing(stdout ?? '');
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                sample = { sent: PING_COUNT, received: 0 };
            }

            this._addSample(sample);
        });
    }

    _addSample(sample) {
        const entry = { time: Date.now(), ...sample };
        this._history.push(entry);

        const cutoff = Date.now() - HISTORY_WINDOW_MS;
        this._history = this._history.filter(s => s.time >= cutoff);

        if (DEBUG)
            console.log(`[online-indicator] ${this._host}: sent=${entry.sent} received=${entry.received} avgRtt=${entry.avgRtt ?? 'n/a'}`);

        if (this.onSample)
            this.onSample(entry);
    }
}
