'use strict';

const { Countdown, decodeSavedMatch, monotonicNow } = require('./countdown');

class MatchModel {
  /**
   * @param {object} options
   * @param {() => object|null} options.load      returns the previously saved JSON object
   * @param {(state: object) => void} options.store
   * @param {() => void} options.onChange
   * @param {() => void} options.onBell
   * @param {() => void} options.onActivityChange
   */
  constructor({ load, store, onChange, onBell, onActivityChange, now = monotonicNow }) {
    this.store = store;
    this.onChange = onChange;
    this.onBell = onBell;
    this.onActivityChange = onActivityChange;
    this.now = now;

    this.countdown = new Countdown(120, now);
    this.stage = 'regular';
    this.regularDuration = 120;
    this.overtimeDuration = 60;
    this.akaScore = 0;
    this.aoScore = 0;
    this.akaName = 'AKA';
    this.aoName = 'SHIRO';
    this.eventTitle = 'KARATE';
    this.soundEnabled = false;
    this.message = null;
    this.pending = null;
    this.lastCheckpoint = 0;

    this.restore(load());
  }

  get mode() { return this.countdown.mode; }
  get remaining() { return this.countdown.remaining; }
  get configuredDuration() { return this.stage === 'regular' ? this.regularDuration : this.overtimeDuration; }
  get formattedTime() { return Countdown.format(this.remaining); }

  snapshot() {
    return {
      remaining: this.remaining,
      total: this.countdown.duration,
      mode: this.mode,
      stage: this.stage,
      regularDuration: this.regularDuration,
      overtimeDuration: this.overtimeDuration,
      akaScore: this.akaScore,
      aoScore: this.aoScore,
      akaName: this.akaName,
      aoName: this.aoName,
      eventTitle: this.eventTitle,
      soundEnabled: this.soundEnabled,
      message: this.message,
      pending: this.pending && { title: this.pending.title, detail: this.pending.detail, button: this.pending.button },
    };
  }

  changed({ persist = true, activity = false } = {}) {
    if (persist) this.save();
    if (activity) this.onActivityChange();
    this.onChange();
  }

  setMessage(message) {
    this.message = message;
    this.onChange();
  }

  // Timer

  toggle() {
    if (this.pending) return;
    if (this.mode === 'running') { this.pause(); return; }
    if (!this.countdown.start()) return;
    this.message = null;
    this.changed({ activity: true });
  }

  pause() {
    const wasRunning = this.mode === 'running';
    this.countdown.pause();
    this.changed({ activity: true });
    if (wasRunning && this.mode === 'finished') this.playBell();
  }

  requestReset() {
    if (this.mode === 'running') this.pause();
    this.countdown.reset(this.configuredDuration);
    this.message = null;
    this.changed({ activity: true });
  }

  setDuration(seconds) {
    if (this.mode === 'running') { this.setMessage('Pause before changing duration.'); return; }
    if (!(Number.isFinite(seconds) && seconds >= 1 && seconds <= Countdown.maximum)) {
      this.setMessage('Duration must be between 00:01 and 99:59.');
      return;
    }
    if (this.stage === 'regular') this.regularDuration = seconds; else this.overtimeDuration = seconds;
    this.countdown.reset(seconds);
    this.message = null;
    this.changed({ activity: true });
  }

  prepareExtraTime() {
    if (this.mode === 'running') { this.setMessage('Pause before starting extra time.'); return; }
    const go = () => {
      this.stage = 'overtime';
      this.countdown.reset(this.overtimeDuration);
      this.message = 'Extra time loaded — press Start when ready.';
      this.changed({ activity: true });
    };
    if (this.mode === 'finished' || this.mode === 'ready') go();
    else this.ask('Load extra time?',
      `Clear the current clock and set ${Countdown.format(this.overtimeDuration)} for extra time.`,
      'Load extra time', go);
  }

  returnToRegular() {
    if (this.mode === 'running') { this.setMessage('Pause before returning to regular time.'); return; }
    const go = () => {
      this.stage = 'regular';
      this.countdown.reset(this.regularDuration);
      this.message = null;
      this.changed({ activity: true });
    };
    if (this.mode === 'finished' || this.mode === 'ready') go();
    else this.ask('Back to regular time?',
      `Clear the current clock and set ${Countdown.format(this.regularDuration)}.`,
      'Regular time', go);
  }

  adjust(seconds) {
    if (!this.countdown.adjust(seconds)) return;
    this.message = null;
    this.changed();
  }

  // Score (WKF-style points: 1 / 2 / 3)

  addScore(side, points) {
    if (![1, 2, 3].includes(points)) return;
    if (side === 'aka') this.akaScore = Math.min(99, this.akaScore + points);
    else if (side === 'shiro') this.aoScore = Math.min(99, this.aoScore + points);
    else return;
    this.changed();
  }

  subtractScore(side) {
    if (side === 'aka') this.akaScore = Math.max(0, this.akaScore - 1);
    else if (side === 'shiro') this.aoScore = Math.max(0, this.aoScore - 1);
    else return;
    this.changed();
  }

  requestResetScores() {
    if (this.akaScore === 0 && this.aoScore === 0) return;
    this.ask('Reset scores?', 'AKA and SHIRO will both return to 0. The timer is not changed.', 'Reset scores', () => {
      this.akaScore = 0;
      this.aoScore = 0;
      this.changed();
    });
  }

  requestNewBout() {
    if (this.mode === 'running') this.pause();
    this.ask('New bout?',
      `Reset the timer to ${Countdown.format(this.configuredDuration)} and clear both scores.`,
      'New bout', () => {
        this.stage = 'regular';
        this.countdown.reset(this.regularDuration);
        this.akaScore = 0;
        this.aoScore = 0;
        this.message = null;
        this.changed({ activity: true });
      });
  }

  // Text and settings

  setText(field, value) {
    if (typeof value !== 'string') return;
    const limits = { akaName: 40, aoName: 40, eventTitle: 80 };
    if (!(field in limits)) return;
    this[field] = [...value].slice(0, limits[field]).join('');
    this.changed();
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    this.changed();
  }

  testSound() {
    this.playBell(true);
    this.setMessage('Test bell played — check speaker volume.');
  }

  // Confirmation

  ask(title, detail, button, perform) {
    this.pending = { title, detail, button, perform };
    this.onChange();
  }

  confirmPending() {
    const action = this.pending?.perform;
    this.pending = null;
    if (action) action(); else this.onChange();
  }

  cancelPending() {
    this.pending = null;
    this.onChange();
  }

  playBell(force = false) {
    if (this.soundEnabled || force) this.onBell();
  }

  /** Called on a short interval. Returns true while the clock is running. */
  refresh() {
    if (this.countdown.tick()) {
      this.changed({ activity: true });
      this.playBell();
      return false;
    }
    if (this.mode !== 'running') return false;
    const now = this.now();
    if (now - this.lastCheckpoint >= 1) { this.save(); this.lastCheckpoint = now; }
    return true;
  }

  // Persistence

  save() {
    this.store({
      stage: this.stage,
      regularDuration: this.regularDuration,
      overtimeDuration: this.overtimeDuration,
      title: this.eventTitle,
      soundEnabled: this.soundEnabled,
      remaining: this.countdown.remaining,
      duration: this.countdown.duration,
      mode: this.countdown.mode,
      akaScore: this.akaScore,
      aoScore: this.aoScore,
      akaName: this.akaName,
      aoName: this.aoName,
    });
  }

  restore(raw) {
    const saved = decodeSavedMatch(raw);
    if (!saved) return;
    this.stage = saved.stage;
    this.regularDuration = saved.regularDuration;
    this.overtimeDuration = saved.overtimeDuration;
    this.eventTitle = saved.title;
    this.soundEnabled = saved.soundEnabled;
    this.akaScore = saved.akaScore;
    this.aoScore = saved.aoScore;
    this.akaName = saved.akaName;
    this.aoName = saved.aoName;
    this.countdown.restore(saved.remaining, saved.duration, saved.mode);
    if (saved.mode !== 'ready') this.message = 'Previous time recovered. Check before resuming.';
  }
}

module.exports = { MatchModel };
