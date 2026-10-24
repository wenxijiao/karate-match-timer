'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, powerSaveBlocker, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { MatchModel } = require('./match-model');

const RENDERER = path.join(__dirname, 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const BACKGROUND = '#0f110e';
const AUDIENCE_BACKGROUND = '#080807';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showControls());
  app.whenReady().then(start).catch(failStartup);
}

/** Without this, a startup error leaves a windowless process holding the single-instance lock. */
function failStartup(error) {
  console.error(error);
  dialog.showErrorBox('Karate Match Timer could not start', String(error?.stack ?? error));
  app.exit(1);
}

// Persistence

function dataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readJSON(name) {
  try { return JSON.parse(fs.readFileSync(dataFile(name), 'utf8')); } catch { return null; }
}

function writeJSON(name, value) {
  const file = dataFile(name);
  const temp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
  } catch (error) {
    console.error(`Could not save ${name}:`, error);
  }
}

const DEFAULTS_VERSION = 4;
const prefs = Object.assign(
  { showScore: false, controlBounds: null, musicEnabled: false, musicPath: null, defaultsVersion: 0 },
  readJSON('prefs.json'));
const savePrefs = () => writeJSON('prefs.json', prefs);
// Older installs saved earlier defaults; apply each later default change once.
// v2: score screen and time-up bell off. v4: music is supplied by the operator.
const previousDefaults = prefs.defaultsVersion;
const turnBellOff = previousDefaults < 2;
if (previousDefaults < 2) prefs.showScore = false;
if (previousDefaults < 4 && !prefs.musicPath) prefs.musicEnabled = false;
if (previousDefaults < DEFAULTS_VERSION) {
  prefs.defaultsVersion = DEFAULTS_VERSION;
  savePrefs();
}

const MUSIC_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm'];
const MUSIC_MAX_BYTES = 300 * 1024 * 1024;
const musicPath = () => prefs.musicPath;
let musicVersion = 1;

// State

let model;
let controlWindow = null;
const audience = { timer: null, score: null };
const audienceScreen = { timer: null, score: null };
let screens = [];
let timerScreenID = 0;
let scoreScreenID = 0;
let sleepBlocker = null;
let broadcastQueued = false;
let quitConfirmed = false;

const anyDisplayOpen = () => Boolean(audience.timer || audience.score);

function snapshot() {
  return {
    ...model.snapshot(),
    showScore: prefs.showScore,
    keepingAwake: sleepBlocker !== null,
    screens,
    timerScreenID,
    scoreScreenID,
    timerDisplayOpen: Boolean(audience.timer),
    scoreDisplayOpen: Boolean(audience.score),
    music: {
      enabled: prefs.musicEnabled,
      name: musicPath() ? path.basename(musicPath()) : 'No music selected',
      hasSelection: Boolean(prefs.musicPath),
      version: musicVersion,
    },
  };
}

function broadcastNow() {
  broadcastQueued = false;
  const state = snapshot();
  for (const win of [controlWindow, audience.timer, audience.score]) {
    if (win && !win.isDestroyed()) win.webContents.send('state', state);
  }
}

function broadcast() {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(broadcastNow);
}

function updateActivity() {
  const needed = model.mode === 'running' || anyDisplayOpen();
  if (needed && sleepBlocker === null) {
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!needed && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
  broadcast();
}

function start() {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  model = new MatchModel({
    load: () => readJSON('match.json'),
    store: (state) => writeJSON('match.json', state),
    onChange: broadcast,
    onBell: () => controlWindow?.webContents.send('bell'),
    onActivityChange: updateActivity,
  });
  if (turnBellOff) model.setSoundEnabled(false);

  updateScreens();
  createControlWindow();

  setInterval(() => { if (model.refresh()) broadcast(); }, 40);

  screen.on('display-added', updateScreens);
  screen.on('display-removed', updateScreens);
  screen.on('display-metrics-changed', updateScreens);

  registerIPC();
}

// Windows

const webPreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  autoplayPolicy: 'no-user-gesture-required',
  backgroundThrottling: false,
};

function boundsAreVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width && bounds.x + bounds.width > a.x
    && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);
}

function createControlWindow() {
  const saved = prefs.controlBounds;
  const useSaved = saved && boundsAreVisible(saved);
  controlWindow = new BrowserWindow({
    width: useSaved ? saved.width : 1080,
    height: useSaved ? saved.height : 720,
    ...(useSaved ? { x: saved.x, y: saved.y } : { center: true }),
    minWidth: 920,
    minHeight: 640,
    title: 'Karate Match Timer',
    backgroundColor: BACKGROUND,
    icon: path.join(RENDERER, 'icon.png'),
    show: false,
    webPreferences,
  });
  controlWindow.loadFile(path.join(RENDERER, 'control.html'));
  controlWindow.once('ready-to-show', () => controlWindow.show());

  const rememberBounds = () => {
    if (controlWindow.isMaximized() || controlWindow.isMinimized()) return;
    prefs.controlBounds = controlWindow.getBounds();
    savePrefs();
  };
  controlWindow.on('resized', rememberBounds);
  controlWindow.on('moved', rememberBounds);

  controlWindow.on('close', (event) => {
    if (quitConfirmed || model.mode !== 'running') return;
    event.preventDefault();
    model.pause();
    showControls();
    dialog.showMessageBox(controlWindow, {
      type: 'warning',
      title: 'Karate Match Timer',
      message: 'Quit during a match?',
      detail: `Timer paused at ${model.formattedTime}.`,
      buttons: ['Cancel', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response !== 1) return;
      quitConfirmed = true;
      controlWindow.close();
    });
  });

  controlWindow.on('closed', () => {
    controlWindow = null;
    closeDisplays();
    model.save();
    app.quit();
  });
}

function showControls() {
  if (!controlWindow) return;
  if (controlWindow.isMinimized()) controlWindow.restore();
  controlWindow.show();
  controlWindow.focus();
}

function displayFor(id) {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === id) ?? screen.getPrimaryDisplay() ?? all[0];
}

function controlDisplayID() {
  if (!controlWindow) return screen.getPrimaryDisplay().id;
  return screen.getDisplayMatching(controlWindow.getBounds()).id;
}

function openWindow(role, displayID) {
  const display = displayFor(displayID);
  if (!display) { model.setMessage('No display available.'); return; }
  closeWindow(role);

  const win = new BrowserWindow({
    ...display.bounds,
    frame: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    title: role === 'timer' ? 'Timer Display' : 'Score Display',
    backgroundColor: AUDIENCE_BACKGROUND,
    webPreferences,
  });
  win.setMenu(null);
  win.loadFile(path.join(RENDERER, 'audience.html'), { query: { role } });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.setBounds(display.bounds);
    win.setFullScreen(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    // Windows only hides the taskbar for the focused fullscreen window, so on the operator's
    // own screen the audience window keeps focus; its keys are forwarded like the control's.
    if (display.id === controlDisplayID()) {
      win.show();
      win.focus();
    } else {
      win.showInactive();
      showControls();
    }
  });
  win.on('closed', () => {
    if (audience[role] !== win) return;
    audience[role] = null;
    audienceScreen[role] = null;
    updateActivity();
    showControls();
  });

  audience[role] = win;
  audienceScreen[role] = display.id;
  updateActivity();
}

function closeWindow(role) {
  const win = audience[role];
  audience[role] = null;
  audienceScreen[role] = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function openDisplays() {
  assignDefaultScreensIfNeeded();
  if (prefs.showScore && timerScreenID === scoreScreenID) {
    model.setMessage('Timer and score are on the same screen. Connect a second display, or pick different screens.');
  }
  openWindow('timer', timerScreenID);
  if (prefs.showScore) openWindow('score', scoreScreenID);
}

function closeDisplays() {
  closeWindow('timer');
  closeWindow('score');
  if (model) updateActivity();
  showControls();
}

function relayoutOpenDisplays() {
  if (audience.timer) {
    if (timerScreenID === scoreScreenID && audience.score) {
      model.setMessage('Timer and score screens are the same — pick different displays.');
    }
    openWindow('timer', timerScreenID);
  }
  if (audience.score) openWindow('score', scoreScreenID);
}

function applyScoreVisibility() {
  if (!prefs.showScore) {
    closeWindow('score');
    updateActivity();
  } else if (audience.timer && !audience.score) {
    openWindow('score', scoreScreenID);
  }
}

// Screens

let layoutSignature = '';

function updateScreens() {
  const primaryID = screen.getPrimaryDisplay().id;
  const displays = screen.getAllDisplays();
  // Fullscreen windows can change a display's work area; only real layout changes should move windows.
  const signature = JSON.stringify(displays.map((d) => [d.id, d.bounds, d.scaleFactor]));
  const layoutChanged = signature !== layoutSignature;
  layoutSignature = signature;
  let externalIndex = 0;
  screens = displays.map((d) => {
    const isMain = d.id === primaryID;
    if (!isMain) externalIndex += 1;
    const width = Math.round(d.size.width * d.scaleFactor);
    const height = Math.round(d.size.height * d.scaleFactor);
    const label = d.label ? ` · ${d.label}` : '';
    return {
      id: d.id,
      name: `${isMain ? 'Main screen' : `External ${externalIndex}`}${label} · ${width}×${height}`,
      isMain,
    };
  });

  assignDefaultScreensIfNeeded();

  const ids = new Set(displays.map((d) => d.id));
  let lost = false;
  for (const role of ['timer', 'score']) {
    if (audienceScreen[role] !== null && !ids.has(audienceScreen[role])) {
      closeWindow(role);
      lost = true;
    }
  }
  if (lost && model) {
    const wasRunning = model.mode === 'running';
    if (wasRunning) model.pause();
    model.setMessage(wasRunning
      ? 'A display disconnected. Timer paused — check before resume.'
      : 'A display disconnected.');
    updateActivity();
    showControls();
  }

  if (layoutChanged && anyDisplayOpen()) relayoutOpenDisplays();
  if (model) broadcast();
}

function assignDefaultScreensIfNeeded() {
  const externals = screens.filter((s) => !s.isMain).map((s) => s.id);
  const all = screens.map((s) => s.id);
  const valid = new Set(all);

  if (!valid.has(timerScreenID)) timerScreenID = externals[0] ?? all[0] ?? 0;
  if (!valid.has(scoreScreenID)) {
    scoreScreenID = externals.find((id) => id !== timerScreenID)
      ?? all.find((id) => id !== timerScreenID)
      ?? timerScreenID;
  }
  if (timerScreenID === scoreScreenID && externals.length >= 2) {
    [timerScreenID, scoreScreenID] = externals;
  }
}

// Input

function handleKey({ code, key }) {
  if (model.pending) return;

  switch (code) {
    case 'Space': model.toggle(); return;
    case 'KeyR': model.requestReset(); return;
    case 'KeyF': if (anyDisplayOpen()) closeDisplays(); else openDisplays(); return;
    case 'Escape': if (anyDisplayOpen()) closeDisplays(); return;
    default: break;
  }

  if (/^[1-9]$/.test(key)) {
    if (model.mode === 'running') model.setMessage('Pause before changing duration.');
    else model.setDuration(Number(key) * 60);
    return;
  }

  if (!prefs.showScore) return;
  const scoreKeys = {
    KeyQ: ['aka', 1], KeyW: ['aka', 2], KeyE: ['aka', 3],
    KeyI: ['shiro', 1], KeyO: ['shiro', 2], KeyP: ['shiro', 3],
  };
  if (scoreKeys[code]) model.addScore(...scoreKeys[code]);
}

function handleAction(action) {
  if (!action || typeof action.type !== 'string') return;
  switch (action.type) {
    case 'toggle': model.toggle(); break;
    case 'reset': model.requestReset(); break;
    case 'setDuration': model.setDuration(Number(action.seconds)); break;
    case 'adjust': model.adjust(Number(action.seconds)); break;
    case 'extraTime': model.prepareExtraTime(); break;
    case 'regularTime': model.returnToRegular(); break;
    case 'addScore': model.addScore(action.side, Number(action.points)); break;
    case 'subtractScore': model.subtractScore(action.side); break;
    case 'resetScores': model.requestResetScores(); break;
    case 'newBout': model.requestNewBout(); break;
    case 'confirm': model.confirmPending(); break;
    case 'cancel': model.cancelPending(); break;
    case 'setText': model.setText(action.field, action.value); break;
    case 'setSound': model.setSoundEnabled(action.enabled); break;
    case 'testSound': model.testSound(); break;
    case 'dismissMessage': model.setMessage(null); break;
    case 'bellFailed': model.setMessage('Sound could not play. Check audio output.'); break;
    case 'openDisplays': openDisplays(); break;
    case 'closeDisplays': closeDisplays(); break;
    case 'setShowScore':
      prefs.showScore = Boolean(action.enabled);
      savePrefs();
      applyScoreVisibility();
      broadcast();
      break;
    case 'chooseMusic': chooseMusic(); break;
    case 'setMusicEnabled':
      prefs.musicEnabled = Boolean(action.enabled);
      savePrefs();
      broadcast();
      break;
    case 'clearMusic':
      prefs.musicPath = null;
      prefs.musicEnabled = false;
      musicVersion += 1;
      savePrefs();
      broadcast();
      break;
    case 'musicFailed':
      model.setMessage('Music could not play. Choose the file again, or select Countdown only.');
      break;
    case 'setTimerScreen':
      timerScreenID = Number(action.id);
      relayoutOpenDisplays();
      broadcast();
      break;
    case 'setScoreScreen':
      scoreScreenID = Number(action.id);
      relayoutOpenDisplays();
      broadcast();
      break;
    default: break;
  }
}

async function chooseMusic() {
  if (!controlWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(controlWindow, {
    title: 'Choose countdown music',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: MUSIC_EXTENSIONS }],
  });
  if (canceled || !filePaths[0]) { broadcast(); return; }
  prefs.musicPath = filePaths[0];
  prefs.musicEnabled = true;
  musicVersion += 1;
  savePrefs();
  broadcast();
}

async function readMusic() {
  const file = musicPath();
  if (!file) return null;
  try {
    const { size } = await fs.promises.stat(file);
    if (size > MUSIC_MAX_BYTES) return { error: 'too-large' };
    const data = await fs.promises.readFile(file);
    const extension = path.extname(file).slice(1).toLowerCase();
    return { version: musicVersion, extension, data };
  } catch {
    return { error: 'unreadable' };
  }
}

function registerIPC() {
  ipcMain.handle('get-state', () => snapshot());
  ipcMain.handle('get-music', (event) => (controlWindow && event.sender === controlWindow.webContents ? readMusic() : null));
  ipcMain.on('key', (_event, payload) => {
    if (payload && typeof payload.code === 'string' && typeof payload.key === 'string') handleKey(payload);
  });
  ipcMain.on('action', (event, action) => {
    if (controlWindow && event.sender === controlWindow.webContents) handleAction(action);
  });
}

app.on('before-quit', () => { if (model) model.save(); });
app.on('window-all-closed', () => app.quit());
