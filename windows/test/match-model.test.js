'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MatchModel } = require('../src/match-model');

function makeModel(saved = null) {
  const clock = { time: 0 };
  const events = { bells: 0, stored: null };
  const model = new MatchModel({
    load: () => saved,
    store: (state) => { events.stored = state; },
    onChange: () => {},
    onBell: () => { events.bells += 1; },
    onActivityChange: () => {},
    now: () => clock.time,
  });
  return { model, clock, events };
}

test('time-up bell is off by default', () => {
  const { model } = makeModel();
  assert.equal(model.soundEnabled, false);
});

test('bell rings once when the clock runs out', () => {
  const { model, clock, events } = makeModel();
  model.setSoundEnabled(true);
  model.toggle();
  clock.time = 200;
  model.refresh();
  model.refresh();
  assert.equal(model.mode, 'finished');
  assert.equal(events.bells, 1);
  assert.equal(events.stored.mode, 'finished');
});

test('silent mode skips the bell but the test button still rings', () => {
  const { model, clock, events } = makeModel();
  model.setSoundEnabled(false);
  model.toggle();
  clock.time = 200;
  model.refresh();
  assert.equal(events.bells, 0);
  model.testSound();
  assert.equal(events.bells, 1);
});

test('duration cannot change while running', () => {
  const { model } = makeModel();
  model.toggle();
  model.setDuration(180);
  assert.equal(model.regularDuration, 120);
  assert.equal(model.message, 'Pause before changing duration.');
});

test('new bout waits for confirmation and blocks the timer meanwhile', () => {
  const { model } = makeModel();
  model.addScore('aka', 3);
  model.addScore('shiro', 2);
  model.requestNewBout();
  assert.ok(model.pending);
  model.toggle();
  assert.equal(model.mode, 'ready');
  model.confirmPending();
  assert.equal(model.pending, null);
  assert.equal(model.akaScore, 0);
  assert.equal(model.aoScore, 0);
});

test('scores stay within 0–99', () => {
  const { model } = makeModel();
  model.subtractScore('aka');
  assert.equal(model.akaScore, 0);
  for (let i = 0; i < 40; i += 1) model.addScore('shiro', 3);
  assert.equal(model.aoScore, 99);
  model.addScore('shiro', 4);
  assert.equal(model.aoScore, 99);
});

test('extra time from a paused clock asks first, then loads overtime', () => {
  const { model, clock } = makeModel();
  model.toggle();
  clock.time = 30;
  model.toggle();
  model.prepareExtraTime();
  assert.equal(model.stage, 'regular');
  model.confirmPending();
  assert.equal(model.stage, 'overtime');
  assert.equal(model.remaining, 60);
});

test('recovered running match comes back paused with a warning', () => {
  const { model } = makeModel({
    stage: 'regular', regularDuration: 120, overtimeDuration: 60, title: 'KARATE', soundEnabled: true,
    remaining: 52.4, duration: 120, mode: 'running', akaScore: 2, aoScore: 1, akaName: 'Kim', aoName: 'Lee',
  });
  assert.equal(model.mode, 'paused');
  assert.equal(model.remaining, 52.4);
  assert.equal(model.akaName, 'Kim');
  assert.match(model.message, /recovered/);
});

test('names are truncated to 40 characters', () => {
  const { model } = makeModel();
  model.setText('akaName', 'x'.repeat(60));
  assert.equal(model.akaName.length, 40);
  model.setText('unknown', 'nope');
  assert.equal(model.unknown, undefined);
});
