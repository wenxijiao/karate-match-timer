'use strict';

// Time derives from a monotonic deadline; animation frequency never determines elapsed time.
class MatchClock {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.duration = 120000;
    this.remaining = 120000;
    this.mode = 'ready';
    this.deadline = 0;
  }
  value() {
    return this.mode === 'running' ? Math.max(0, this.deadline - this.now()) : this.remaining;
  }
  start() {
    if (this.mode === 'running' || this.value() <= 0) return false;
    this.deadline = this.now() + this.remaining;
    this.mode = 'running';
    return true;
  }
  pause() {
    if (this.mode !== 'running') return;
    this.remaining = this.value();
    this.mode = this.remaining > 0 ? 'paused' : 'finished';
  }
  tick() {
    if (this.mode === 'running' && this.value() <= 0) {
      this.remaining = 0;
      this.mode = 'finished';
      return true;
    }
    return false;
  }
  reset(ms = this.duration) {
    this.duration = ms;
    this.remaining = ms;
    this.mode = 'ready';
    this.deadline = 0;
  }
  adjust(ms) {
    if (this.mode === 'running') return;
    this.remaining = Math.min(5999000, Math.max(0, this.remaining + ms));
    this.duration = Math.max(this.duration, this.remaining);
    this.mode = this.remaining > 0 ? 'paused' : 'finished';
  }
}
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const displayMode = params.get('display') === '1';
const token = displayMode ? params.get('session') : globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();
const clock = new MatchClock();
let stage = 'regular',
  durations = {
    regular: 120000,
    overtime: 60000
  },
  title = 'KARATE EXHIBITION',
  sound = true;
let displayWindow = null,
  displayLastSeen = 0,
  lastState = null,
  lastReceived = 0,
  displayBase = 0,
  displayRemaining = 0,
  channel = null;
let audioContext = null,
  wakeLock = null,
  pendingConfirm = null,
  toastTimeout,
  lastPersist = 0,
  lastSent = 0,
  restored = false;
const storageKey = 'karate-timer-settings-v1';
try {
  channel = new BroadcastChannel('karate-timer-' + token);
  channel.onmessage = e => receive(e.data, null);
} catch {}
function fmt(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').hidden = true, 4200);
}
function validMs(n) {
  return Number.isFinite(n) && n >= 0 && n <= 5999000;
}
function persist() {
  if (displayMode) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      stage,
      durations,
      title,
      sound,
      remaining: clock.value(),
      mode: clock.mode,
      duration: clock.duration
    }));
  } catch {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(storageKey));
    if (!s) return;
    if (validMs(s.durations?.regular) && s.durations.regular > 0) durations.regular = s.durations.regular;
    if (validMs(s.durations?.overtime) && s.durations.overtime > 0) durations.overtime = s.durations.overtime;
    if (s.stage === 'overtime') stage = s.stage;
    if (typeof s.title === 'string') title = s.title.slice(0, 35);
    if (typeof s.sound === 'boolean') sound = s.sound;
    clock.reset(durations[stage]);
    if (validMs(s.remaining) && validMs(s.duration) && ['paused', 'running', 'finished'].includes(s.mode)) {
      clock.duration = s.duration;
      clock.remaining = s.remaining;
      clock.mode = s.remaining === 0 ? 'finished' : 'paused';
      restored = true;
    }
  } catch {}
}
function snapshot() {
  return {
    type: 'state',
    token,
    title,
    stage,
    mode: clock.mode,
    remaining: clock.value(),
    duration: clock.duration,
    sentAt: Date.now()
  };
}
function send(message) {
  try {
    channel?.postMessage(message);
  } catch {}
  try {
    if (displayMode) window.opener?.postMessage(message, '*');else if (displayWindow && !displayWindow.closed) displayWindow.postMessage(message, '*');
  } catch {}
}
function sync() {
  send(snapshot());
  lastSent = performance.now();
}
function receive(message, source) {
  if (!message || message.token !== token) return;
  if (source && source !== (displayMode ? window.opener : displayWindow)) return;
  if (displayMode && message.type === 'state') {
    if (!validMs(message.remaining) || !validMs(message.duration) || !['ready', 'paused', 'running', 'finished'].includes(message.mode)) return;
    lastState = message;
    lastReceived = performance.now();
    displayBase = performance.now();
    displayRemaining = Math.max(0, message.remaining - Math.max(0, Date.now() - message.sentAt));
    if (message.mode !== 'running') displayRemaining = message.remaining;
    send({
      type: 'hello',
      token
    });
    if (message.mode === 'running') requestWake();else releaseWake();
  } else if (!displayMode && message.type === 'hello') {
    displayLastSeen = performance.now();
  } else if (displayMode && message.type === 'closing') {
    lastReceived = -10000;
  }
}
window.addEventListener('message', e => receive(e.data, e.source));
function initAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    return audioContext.resume();
  } catch {
    return Promise.reject(new Error('audio unavailable'));
  }
}
async function bell(test = false) {
  if (!sound && !test) return;
  try {
    await initAudio();
    for (let i = 0; i < 3; i++) {
      const at = audioContext.currentTime + i * .38;
      for (const [frequency, volume] of [[880, .3], [1320, .12], [1760, .06]]) {
        const osc = audioContext.createOscillator(),
          gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(volume, at + .008);
        gain.gain.exponentialRampToValueAtTime(.001, at + .65);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start(at);
        osc.stop(at + .7);
      }
    }
  } catch {
    toast('Bell unavailable. Check browser audio and speaker volume.');
  }
}
async function requestWake() {
  if (wakeLock || document.visibilityState !== 'visible') return;
  try {
    if (!navigator.wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      updateWake();
    });
    updateWake();
  } catch {
    updateWake();
  }
}
function releaseWake() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  updateWake();
}
function updateWake() {
  $('wakeStatus').textContent = wakeLock ? 'Running - screen kept awake' : 'Ready - connect power and disable automatic sleep';
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if ((displayMode ? lastState?.mode : clock.mode) === 'running') requestWake();
    if (displayMode) send({
      type: 'hello',
      token
    });else {
      if (clock.tick()) finish();
      sync();
    }
  }
});
function confirmAction(heading, body, label, action) {
  pendingConfirm = action;
  $('confirmTitle').textContent = heading;
  $('confirmBody').textContent = body;
  $('acceptConfirm').textContent = label;
  $('confirmDialog').showModal();
}
function closeConfirm() {
  $('confirmDialog').close();
  pendingConfirm = null;
}
$('cancelConfirm').onclick = closeConfirm;
$('confirmDialog').addEventListener('cancel', () => {
  pendingConfirm = null;
});
$('acceptConfirm').onclick = () => {
  const action = pendingConfirm;
  closeConfirm();
  action?.();
};
function hasProgress() {
  return clock.mode !== 'ready';
}
function reset() {
  if (clock.mode === 'running') pause();
  const action = () => {
    clock.reset(durations[stage]);
    persist();
    updateSettings();
    sync();
    render();
  };
  if (hasProgress()) confirmAction('Reset timer?', 'Clear the remaining time and reset to ' + fmt(durations[stage]) + '.', 'Reset timer', action);else action();
}
function pause() {
  clock.pause();
  releaseWake();
  persist();
  sync();
  render();
}
function toggle() {
  if (displayMode || $('confirmDialog').open) return;
  if (clock.mode === 'running') {
    pause();
    return;
  }
  if (clock.value() <= 0) {
    toast('The round has finished. Reset the timer to start again.');
    return;
  }
  if (sound) initAudio().catch(() => toast('Bell unavailable. Check browser audio settings.'));
  clock.start();
  requestWake();
  persist();
  sync();
  render();
}
function finish() {
  releaseWake();
  persist();
  sync();
  bell();
  render();
}
function changeDuration(ms) {
  if (clock.mode === 'running') {
    toast('Pause the timer before changing its duration.');
    return;
  }
  const action = () => {
    durations[stage] = ms;
    clock.reset(ms);
    persist();
    updateSettings();
    sync();
    render();
  };
  if (hasProgress()) confirmAction('Change duration?', 'Clear the current timer and set it to ' + fmt(ms) + '.', 'Apply duration', action);else action();
}
function changeStage(next) {
  if (next === stage) return;
  if (clock.mode === 'running') {
    toast('Pause the timer before changing stages.');
    return;
  }
  const action = () => {
    stage = next;
    clock.reset(durations[stage]);
    persist();
    updateSettings();
    sync();
    render();
  };
  if (hasProgress()) confirmAction('Switch to ' + (next === 'regular' ? 'Regular time' : 'Extra time') + '?', 'Clear the current timer. The next stage starts at ' + fmt(durations[next]) + '.', 'Change stage', action);else action();
}
function updateSettings() {
  for (const key of ['regular', 'overtime']) {
    $(key).classList.toggle('selected', key === stage);
    $(key).setAttribute('aria-pressed', String(key === stage));
  }
  document.querySelectorAll('[data-duration]').forEach(b => {
    const selected = Number(b.dataset.duration) * 1000 === durations[stage];
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-pressed', String(selected));
    b.disabled = clock.mode === 'running';
  });
  const secs = durations[stage] / 1000;
  $('minutes').value = Math.floor(secs / 60);
  $('seconds').value = secs % 60;
  $('eventTitle').value = title;
  $('soundToggle').setAttribute('aria-checked', String(sound));
}
function render() {
  let mode,
    remaining,
    duration,
    stageName,
    currentTitle,
    disconnected = false;
  if (displayMode) {
    disconnected = !lastState || performance.now() - lastReceived > 6000;
    if (!lastState) {
      mode = 'ready';
      remaining = 0;
      duration = 0;
      stageName = 'Connecting';
      currentTitle = 'KARATE EXHIBITION';
    } else {
      mode = lastState.mode;
      remaining = mode === 'running' ? Math.max(0, displayRemaining - (performance.now() - displayBase)) : lastState.remaining;
      duration = lastState.duration;
      stageName = lastState.stage === 'regular' ? 'Regular time' : 'Extra time';
      currentTitle = lastState.title;
      if (mode === 'running' && remaining === 0) mode = 'finished';
    }
  } else {
    mode = clock.mode;
    remaining = clock.value();
    duration = clock.duration;
    stageName = stage === 'regular' ? 'Regular time' : 'Extra time';
    currentTitle = title;
  }
  const warning = mode === 'running' && remaining > 0 && remaining <= 10000;
  $('arena').className = 'arena ' + mode + (warning ? ' warning' : '');
  $('eventLabel').textContent = currentTitle;
  $('roundName').textContent = stageName;
  $('time').textContent = displayMode && !lastState ? '--:--' : fmt(remaining);
  $('statusBadge').textContent = {
    ready: 'Ready',
    running: 'Running',
    paused: 'Paused',
    finished: 'Finished'
  }[mode];
  $('stateText').textContent = disconnected ? 'Control disconnected - pause the match' : {
    ready: 'Waiting to start',
    running: warning ? 'Final 10 seconds' : 'Round in progress',
    paused: 'Pause',
    finished: 'Time up'
  }[mode];
  $('stateText').classList.toggle('display-notice', disconnected);
  $('progressFill').style.width = (duration ? Math.min(100, remaining / duration * 100) : 0) + '%';
  $('durationLabel').textContent = stageName + ' duration ' + fmt(duration);
  if (displayMode) {
    $('connectionLabel').textContent = disconnected ? 'Keep the control window open' : 'Audience display connected';
  } else {
    const connected = performance.now() - displayLastSeen < 3500 && displayLastSeen > 0;
    $('connectionLabel').textContent = connected ? '● Audience display connected' : 'Audience display not connected';
    $('toggle').innerHTML = mode === 'running' ? '<span aria-hidden="true">Ⅱ</span> Pause timer' : mode === 'paused' ? '<span aria-hidden="true">▶</span> Resume timer' : mode === 'finished' ? 'Finished' : '<span aria-hidden="true">▶</span> Start timer';
    $('toggle').disabled = mode === 'finished';
    for (const id of ['minus', 'plus', 'minutes', 'seconds', 'applyDuration', 'regular', 'overtime']) $(id).disabled = mode === 'running';
    document.querySelectorAll('[data-duration]').forEach(b => b.disabled = mode === 'running');
  }
}
function openDisplay() {
  if (displayWindow && !displayWindow.closed) {
    displayWindow.focus();
    sync();
    return;
  }
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('display', '1');
  url.searchParams.set('session', token);
  displayWindow = window.open(url.href, 'karate-display-' + token, 'popup=yes,width=1200,height=750');
  if (!displayWindow) {
    toast('Popup blocked. Allow popups for this page and try again.');
    return;
  }
  toast('Move the new window to the external screen, then select Full screen.');
  sync();
}
async function fullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
    return;
  }
  if (!document.documentElement.requestFullscreen) {
    toast('Full screen is unavailable here. Use the browser window menu.');
    return;
  }
  document.body.classList.add('presentation');
  try {
    await document.documentElement.requestFullscreen();
    if (displayMode || clock.mode === 'running') requestWake();
  } catch {
    if (!displayMode) document.body.classList.remove('presentation');
    toast('Could not enter full screen. Use the browser window menu.');
  }
}
document.addEventListener('fullscreenchange', () => {
  if (!displayMode && !document.fullscreenElement) document.body.classList.remove('presentation');
});
$('fullscreen').onclick = fullscreen;
$('displayFullscreen').onclick = fullscreen;
$('openDisplay').onclick = openDisplay;
$('openDisplay2').onclick = openDisplay;
$('exitPresentation').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('presentation');
};
$('toggle').onclick = toggle;
$('reset').onclick = reset;
$('minus').onclick = () => {
  clock.adjust(-10000);
  persist();
  sync();
  render();
};
$('plus').onclick = () => {
  clock.adjust(10000);
  persist();
  sync();
  render();
};
$('regular').onclick = () => changeStage('regular');
$('overtime').onclick = () => changeStage('overtime');
document.querySelectorAll('[data-duration]').forEach(b => b.onclick = () => changeDuration(Number(b.dataset.duration) * 1000));
$('applyDuration').onclick = () => {
  const m = Number($('minutes').value),
    s = Number($('seconds').value);
  if ($('minutes').value === '' || $('seconds').value === '' || !Number.isInteger(m) || !Number.isInteger(s) || m < 0 || m > 99 || s < 0 || s > 59 || m * 60 + s < 1) {
    toast('Enter a duration from 00:01 to 99:59, with seconds from 0 to 59.');
    return;
  }
  changeDuration((m * 60 + s) * 1000);
};
$('eventTitle').addEventListener('input', () => {
  title = $('eventTitle').value.trim() || 'KARATE';
  persist();
  sync();
  render();
});
$('soundToggle').onclick = () => {
  sound = !sound;
  $('soundToggle').setAttribute('aria-checked', String(sound));
  if (sound) initAudio().catch(() => {});
  persist();
};
$('testSound').onclick = () => {
  bell(true);
  toast('Test bell playing. Check your computer or external speaker volume.');
};
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || $('confirmDialog').open || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!displayMode) toggle();
  } else if (e.key.toLowerCase() === 'r' && !displayMode) {
    e.preventDefault();
    reset();
  } else if (e.key.toLowerCase() === 'f') {
    e.preventDefault();
    fullscreen();
  }
});
window.addEventListener('beforeunload', e => {
  if (!displayMode) {
    persist();
    send({
      type: 'closing',
      token
    });
    if (clock.mode === 'running') {
      e.preventDefault();
      e.returnValue = '';
    }
  }
});
if (displayMode) {
  document.body.classList.add('presentation');
  $('exitPresentation').classList.add('hidden');
  send({
    type: 'hello',
    token
  });
  setInterval(() => send({
    type: 'hello',
    token
  }), 1000);
  document.title = 'Audience Display - Karate Match Timer';
} else {
  load();
  updateSettings();
  if (restored) toast('Previous time restored. Check the remaining time before resuming.');
}
render();
setInterval(() => {
  if (!displayMode) {
    if (clock.tick()) finish();
    if (performance.now() - lastSent > 240) sync();
    if (clock.mode === 'running' && performance.now() - lastPersist > 1000) {
      persist();
      lastPersist = performance.now();
    }
  }
  render();
}, 80);
