'use strict';

// Runs src/main.js against a fake `electron` module so startup and window wiring are exercised without Electron.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

function createFakeElectron() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'karate-smoke-'));
  const errors = [];
  const windows = [];
  const focusLog = [];
  const musicFile = path.join(userData, 'walk-on.mp3');
  fs.writeFileSync(musicFile, Buffer.from([0xff, 0xfb, 0x90, 0x00]));
  const ipcHandlers = {};
  const ipcListeners = {};
  const screenListeners = {};
  let displays = [
    { id: 1, label: 'Laptop', bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 1440, height: 860 }, size: { width: 1440, height: 900 }, scaleFactor: 2 },
    { id: 2, label: 'Timer TV', bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
    { id: 3, label: 'Score TV', bounds: { x: 3360, y: 0, width: 1920, height: 1080 }, workArea: { x: 3360, y: 0, width: 1920, height: 1040 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 },
  ];

  class Emitter {
    constructor() { this.handlers = {}; }
    on(name, fn) { (this.handlers[name] ??= []).push(fn); return this; }
    once(name, fn) {
      const wrapper = (...args) => { this.off(name, wrapper); fn(...args); };
      return this.on(name, wrapper);
    }
    off(name, fn) { this.handlers[name] = (this.handlers[name] ?? []).filter((h) => h !== fn); }
    emit(name, ...args) { for (const fn of [...(this.handlers[name] ?? [])]) fn(...args); }
  }

  class BrowserWindow extends Emitter {
    constructor(options) {
      super();
      if (typeof options !== 'object') throw new TypeError('options must be an object');
      if (options.webPreferences && typeof options.webPreferences !== 'object') {
        throw new TypeError('webPreferences must be an object');
      }
      this.options = options;
      this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 800, height: options.height ?? 600 };
      this.destroyed = false;
      this.visible = false;
      this.fullScreen = false;
      this.sent = [];
      this.webContents = { send: (channel, payload) => this.sent.push([channel, payload]) };
      windows.push(this);
    }
    loadFile(file, opts) {
      assert.ok(fs.existsSync(file), `missing page ${file}`);
      this.file = file;
      this.query = opts?.query;
      setImmediate(() => this.emit('ready-to-show'));
      return Promise.resolve();
    }
    show() { this.visible = true; }
    showInactive() { this.visible = true; }
    focus() { focusLog.push(this); }
    restore() {}
    isMinimized() { return false; }
    isMaximized() { return false; }
    isDestroyed() { return this.destroyed; }
    getBounds() { return { ...this.bounds }; }
    setBounds(bounds) { this.bounds = { ...bounds }; }
    setFullScreen(value) { this.fullScreen = value; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    setMenu() {}
    close() {
      let prevented = false;
      this.emit('close', { preventDefault: () => { prevented = true; } });
      if (!prevented) this.destroy();
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }
  }

  const app = new Emitter();
  Object.assign(app, {
    quitCalled: false,
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: () => userData,
    quit() { this.quitCalled = true; },
    exit(code) { errors.push(`exit ${code}`); },
  });

  const electron = {
    app,
    BrowserWindow,
    Menu: { setApplicationMenu() {} },
    dialog: {
      showErrorBox: (title, body) => errors.push(`${title}: ${body}`),
      showMessageBox: () => Promise.resolve({ response: 1 }),
      showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [musicFile] }),
    },
    ipcMain: {
      handle: (channel, fn) => { ipcHandlers[channel] = fn; },
      on: (channel, fn) => { ipcListeners[channel] = fn; },
    },
    powerSaveBlocker: { nextId: 1, active: new Set(),
      start() { const id = this.nextId++; this.active.add(id); return id; },
      stop(id) { this.active.delete(id); } },
    screen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => displays[0],
      getDisplayMatching: (bounds) => displays.find((d) => bounds.x >= d.bounds.x && bounds.x < d.bounds.x + d.bounds.width) ?? displays[0],
      on: (name, fn) => { (screenListeners[name] ??= []).push(fn); },
    },
  };

  return {
    electron, errors, windows, focusLog, ipcHandlers, ipcListeners, userData,
    setDisplays(next) { displays = next; for (const fn of screenListeners['display-removed'] ?? []) fn(); },
    get displays() { return displays; },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Loads src/main.js against `fake`, runs `body`, then restores globals. */
async function withMain(fake, body) {
  const originalLoad = Module._load;
  Module._load = function load(request, ...rest) {
    return request === 'electron' ? fake.electron : originalLoad.call(this, request, ...rest);
  };
  const mainPath = require.resolve('../src/main');
  delete require.cache[mainPath];
  const intervals = [];
  const originalSetInterval = global.setInterval;
  global.setInterval = (...args) => { const id = originalSetInterval(...args); intervals.push(id); return id; };
  try {
    require(mainPath);
    await tick(); await tick(); await tick();
    assert.deepEqual(fake.errors, [], 'startup must not fail');
    const control = fake.windows[0];
    const fromControl = { sender: control.webContents };
    await body({
      control,
      act: (action) => fake.ipcListeners.action(fromControl, action),
      key: (code, k) => fake.ipcListeners.key({}, { code, key: k }),
      getState: () => fake.ipcHandlers['get-state'](),
      getMusic: () => fake.ipcHandlers['get-music'](fromControl),
    });
    assert.deepEqual(fake.errors, []);
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    intervals.forEach(clearInterval);
    delete require.cache[mainPath];
  }
}

test('main process starts, drives displays and shuts down cleanly', async () => {
  const fake = createFakeElectron();
  await withMain(fake, async ({ control, act, key, getState }) => {
    assert.ok(control.file.endsWith('control.html'));
    assert.equal(control.visible, true, 'control window is shown');

    let state = await getState();
    assert.equal(state.showScore, false, 'score screen is off by default');
    assert.equal(state.soundEnabled, false, 'time-up bell is off by default');
    assert.equal(state.music.enabled, false, 'countdown music is opt-in');
    assert.equal(state.screens.length, 3);
    assert.equal(state.timerScreenID, 2, 'first external screen gets the timer');
    assert.equal(state.scoreScreenID, 3, 'second external screen gets the score');

    act({ type: 'setShowScore', enabled: true });
    act({ type: 'openDisplays' });
    await tick(); await tick();
    const [timerWin, scoreWin] = fake.windows.slice(1);
    assert.equal(timerWin.query.role, 'timer');
    assert.equal(scoreWin.query.role, 'score');
    assert.deepEqual(timerWin.bounds, fake.displays[1].bounds);
    assert.deepEqual(scoreWin.bounds, fake.displays[2].bounds);
    assert.equal(timerWin.fullScreen, true);
    assert.equal(fake.focusLog.at(-1), control, 'with external screens the operator keeps the control window');
    assert.equal(fake.electron.powerSaveBlocker.active.size, 1, 'keeps the PC awake while displays are open');

    key('KeyQ', 'q'); key('KeyE', 'e'); key('KeyP', 'p');
    key('Space', ' ');
    await tick();
    state = await getState();
    assert.equal(state.akaScore, 4);
    assert.equal(state.aoScore, 3);
    assert.equal(state.mode, 'running');
    assert.ok(control.sent.some(([channel]) => channel === 'state'), 'state is broadcast to the control window');

    fake.setDisplays(fake.displays.slice(0, 2));
    await tick();
    state = await getState();
    assert.equal(state.mode, 'paused', 'losing an audience screen pauses the clock');
    assert.equal(state.scoreDisplayOpen, false);
    assert.match(state.message, /disconnected/);

    key('KeyF', 'f');
    state = await getState();
    assert.equal(state.timerDisplayOpen, false);

    key('Space', ' ');
    control.close();
    await tick(); await tick();
    assert.equal(control.destroyed, true, 'quit confirmation closes the window');
    assert.equal(fake.electron.app.quitCalled, true);
    const saved = JSON.parse(fs.readFileSync(path.join(fake.userData, 'match.json'), 'utf8'));
    assert.equal(saved.mode, 'paused', 'quitting mid-bout saves a paused clock');
  });
});

test('single screen: the fullscreen timer keeps focus and R does not pull up the controls', async () => {
  const fake = createFakeElectron();
  fake.setDisplays(fake.displays.slice(0, 1));
  await withMain(fake, async ({ act, key, getState }) => {
    act({ type: 'openDisplays' });
    await tick(); await tick();
    const timerWin = fake.windows[1];
    assert.equal(timerWin.fullScreen, true);
    assert.equal(timerWin.alwaysOnTop, true, 'topmost so the taskbar stays hidden');
    assert.equal(fake.focusLog.at(-1), timerWin, 'the fullscreen timer holds focus');

    key('Space', ' ');
    key('KeyR', 'r');
    await tick();
    assert.equal(fake.focusLog.at(-1), timerWin, 'R resets without focusing the control window');
    assert.equal((await getState()).mode, 'ready');

    key('Escape', 'Escape');
    assert.equal((await getState()).timerDisplayOpen, false);
  });
});

test('countdown music: no bundled track, custom choice, clear selection, countdown only', async () => {
  const fake = createFakeElectron();
  await withMain(fake, async ({ act, getState, getMusic }) => {
    assert.equal(await getMusic(), null);
    assert.equal((await getState()).music.name, 'No music selected');

    act({ type: 'chooseMusic' });
    await tick(); await tick();
    let state = await getState();
    assert.deepEqual(state.music, { enabled: true, name: 'walk-on.mp3', hasSelection: true, version: 2 });
    assert.equal((await getMusic()).data.length, 4);
    let prefs = JSON.parse(fs.readFileSync(path.join(fake.userData, 'prefs.json'), 'utf8'));
    assert.equal(prefs.musicPath.endsWith('walk-on.mp3'), true, 'chosen file is remembered');

    act({ type: 'clearMusic' });
    state = await getState();
    assert.equal(state.music.hasSelection, false);
    assert.equal(state.music.enabled, false);
    assert.equal(await getMusic(), null);
    assert.equal(state.music.version, 3, 'renderer reloads the track');

    act({ type: 'setMusicEnabled', enabled: false });
    assert.equal((await getState()).music.enabled, false, 'countdown only');
    prefs = JSON.parse(fs.readFileSync(path.join(fake.userData, 'prefs.json'), 'utf8'));
    assert.equal(prefs.musicEnabled, false, 'countdown-only choice is remembered');
  });
});

test('older installs get the new defaults once', async () => {
  const fake = createFakeElectron();
  fs.writeFileSync(path.join(fake.userData, 'prefs.json'),
    JSON.stringify({ showScore: true, musicEnabled: false, musicPath: null, defaultsVersion: 2 }));
  await withMain(fake, async ({ getState }) => {
    const state = await getState();
    assert.equal(state.music.enabled, false, 'music remains off without a selected track');
    assert.equal(state.showScore, true, 'v2 changes are not re-applied');
  });
});
