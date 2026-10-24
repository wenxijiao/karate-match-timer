'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Countdown, decodeSavedMatch } = require('../src/countdown');

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-4, `${actual} ≈ ${expected}`);

test('pause/resume excludes paused time', () => {
  let time = 0;
  const timer = new Countdown(120, () => time);
  assert.equal(timer.start(), true);
  time = 10.35;
  close(timer.remaining, 109.65);
  timer.pause();
  time = 900;
  close(timer.remaining, 109.65);
  assert.equal(timer.start(), true);
  time = 909.65;
  close(timer.remaining, 100);
});

test('delayed refresh finishes once without drift', () => {
  let time = 100;
  const timer = new Countdown(180, () => time);
  timer.start();
  time = 350;
  assert.equal(timer.remaining, 0);
  assert.equal(timer.tick(), true);
  assert.equal(timer.mode, 'finished');
  assert.equal(timer.tick(), false);
  assert.equal(timer.start(), false);
});

test('running adjustment is rejected', () => {
  let time = 0;
  const timer = new Countdown(60, () => time);
  timer.start(); time = 5;
  assert.equal(timer.adjust(10), false);
  assert.equal(timer.remaining, 55);
  timer.pause();
  assert.equal(timer.adjust(10), true);
  assert.equal(timer.remaining, 65);
  assert.equal(timer.duration, 65);
});

test('reset and bounds', () => {
  const timer = new Countdown(2);
  timer.adjust(-10);
  assert.equal(timer.remaining, 0);
  assert.equal(timer.mode, 'finished');
  timer.reset(60);
  assert.equal(timer.mode, 'ready');
  assert.equal(timer.remaining, 60);
  timer.adjust(1e12);
  assert.equal(timer.remaining, 5999);
  timer.reset(NaN);
  assert.equal(timer.remaining, 120);
});

test('recovered running match is paused', () => {
  const timer = new Countdown();
  timer.restore(52.4, 120, 'running');
  assert.equal(timer.mode, 'paused');
  assert.equal(timer.remaining, 52.4);
  timer.restore(0, 120, 'finished');
  assert.equal(timer.mode, 'finished');
});

test('display uses ceiling until exact zero', () => {
  assert.equal(Countdown.format(120), '02:00');
  assert.equal(Countdown.format(119.001), '02:00');
  assert.equal(Countdown.format(0.001), '00:01');
  assert.equal(Countdown.format(0), '00:00');
  assert.equal(Countdown.format(5999), '99:59');
});

test('saved state validation and round trip', () => {
  const state = {
    stage: 'overtime', regularDuration: 120, overtimeDuration: 60, title: 'KARATE COMPETITION',
    soundEnabled: false, remaining: 45.5, duration: 60, mode: 'running', akaScore: 3, aoScore: 1,
  };
  const recovered = decodeSavedMatch(JSON.parse(JSON.stringify(state)));
  assert.ok(recovered);
  assert.equal(recovered.stage, 'overtime');
  assert.equal(recovered.soundEnabled, false);
  assert.equal(recovered.akaScore, 3);
  assert.equal(recovered.aoScore, 1);
  assert.equal(decodeSavedMatch({ ...state, remaining: -1 }), null);
});

test('legacy saved state defaults scores to zero', () => {
  const recovered = decodeSavedMatch(JSON.parse(
    '{"stage":"regular","regularDuration":120,"overtimeDuration":60,"title":"KARATE",'
    + '"soundEnabled":true,"remaining":120,"duration":120,"mode":"ready"}'));
  assert.ok(recovered);
  assert.equal(recovered.akaScore, 0);
  assert.equal(recovered.aoScore, 0);
});
