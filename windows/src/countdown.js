'use strict';

const MAXIMUM = 5999;

function monotonicNow() {
  return Number(process.hrtime.bigint()) / 1e9;
}

function clampDuration(seconds) {
  return Number.isFinite(seconds) ? Math.min(MAXIMUM, Math.max(1, seconds)) : 120;
}

/** A continuous, monotonic deadline. UI refresh frequency cannot change elapsed time. */
class Countdown {
  constructor(duration = 120, now = monotonicNow) {
    this.now = now;
    this.duration = clampDuration(duration);
    this.mode = 'ready';
    this.storedRemaining = this.duration;
    this.deadline = 0;
  }

  get remaining() {
    return this.mode === 'running' ? Math.max(0, this.deadline - this.now()) : this.storedRemaining;
  }

  start() {
    if (this.mode === 'running' || this.storedRemaining <= 0) return false;
    this.deadline = this.now() + this.storedRemaining;
    this.mode = 'running';
    return true;
  }

  pause() {
    if (this.mode !== 'running') return;
    this.storedRemaining = this.remaining;
    this.mode = this.storedRemaining > 0 ? 'paused' : 'finished';
  }

  tick() {
    if (this.mode !== 'running' || this.remaining > 0) return false;
    this.storedRemaining = 0;
    this.mode = 'finished';
    return true;
  }

  reset(seconds) {
    if (seconds !== undefined) this.duration = clampDuration(seconds);
    this.storedRemaining = this.duration;
    this.mode = 'ready';
    this.deadline = 0;
  }

  adjust(seconds) {
    if (this.mode === 'running' || !Number.isFinite(seconds)) return false;
    this.storedRemaining = Math.min(MAXIMUM, Math.max(0, this.storedRemaining + seconds));
    this.duration = Math.max(this.duration, this.storedRemaining);
    this.mode = this.storedRemaining > 0 ? 'paused' : 'finished';
    return true;
  }

  /** Recovery always requires an explicit resume, including after an unexpected exit. */
  restore(seconds, duration, mode) {
    this.duration = clampDuration(duration);
    this.storedRemaining = Number.isFinite(seconds) ? Math.min(MAXIMUM, Math.max(0, seconds)) : this.duration;
    this.duration = Math.max(this.duration, this.storedRemaining);
    this.mode = mode === 'ready' ? 'ready' : (this.storedRemaining > 0 ? 'paused' : 'finished');
    if (this.mode === 'ready') this.storedRemaining = this.duration;
  }

  static format(seconds) {
    const safe = Number.isFinite(seconds) ? Math.min(MAXIMUM, Math.max(0, seconds)) : 0;
    const total = Math.ceil(safe);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }
}

Countdown.maximum = MAXIMUM;

const STAGES = ['regular', 'overtime'];
const MODES = ['ready', 'running', 'paused', 'finished'];

function inDurationRange(value) {
  return Number.isFinite(value) && value >= 1 && value <= MAXIMUM;
}

/** Fills defaults for fields added after the first release, then validates. Returns null if invalid. */
function decodeSavedMatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const saved = {
    stage: raw.stage,
    regularDuration: raw.regularDuration,
    overtimeDuration: raw.overtimeDuration,
    title: raw.title,
    soundEnabled: raw.soundEnabled,
    remaining: raw.remaining,
    duration: raw.duration,
    mode: raw.mode,
    akaScore: raw.akaScore ?? 0,
    aoScore: raw.aoScore ?? 0,
    akaName: raw.akaName ?? 'AKA',
    aoName: raw.aoName ?? 'SHIRO',
  };
  const isScore = (v) => Number.isInteger(v) && v >= 0 && v <= 99;
  const valid = STAGES.includes(saved.stage) && MODES.includes(saved.mode)
    && [saved.regularDuration, saved.overtimeDuration, saved.duration].every(inDurationRange)
    && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= MAXIMUM
    && typeof saved.title === 'string' && saved.title.length <= 80
    && typeof saved.soundEnabled === 'boolean'
    && typeof saved.akaName === 'string' && saved.akaName.length <= 40
    && typeof saved.aoName === 'string' && saved.aoName.length <= 40
    && isScore(saved.akaScore) && isScore(saved.aoScore);
  return valid ? saved : null;
}

module.exports = { Countdown, decodeSavedMatch, monotonicNow };
