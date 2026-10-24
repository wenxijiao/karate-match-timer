'use strict';

(async () => {
  const $ = (id) => document.getElementById(id);
  const send = (type, extra = {}) => window.karate.send({ type, ...extra });
  const format = KarateView.format;

  const renderTimer = KarateView.createTimerView($('timerPreview'), false);
  const renderScore = KarateView.createScoreView($('scorePreview'), false);

  let state = null;
  let editingTitle = false;
  let editingNames = false;

  // Shortcuts: text editing and confirmation dialogs keep the keyboard for themselves.
  KarateView.installShortcuts(() => editingTitle || editingNames || Boolean(state?.pending));
  document.addEventListener('keydown', (event) => {
    if (state?.pending) {
      if (event.key === 'Escape') { event.preventDefault(); send('cancel'); }
      if (event.key === 'Enter') { event.preventDefault(); send('confirm'); }
      // A reflexive Space press must never confirm a destructive dialog.
      if (event.code === 'Space') event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && (editingTitle || editingNames)) {
      event.preventDefault();
      finishTitleEdit();
      finishNameEdit();
    }
  });

  // Displays
  $('timerScreen').addEventListener('change', (e) => send('setTimerScreen', { id: Number(e.target.value) }));
  $('scoreScreen').addEventListener('change', (e) => send('setScoreScreen', { id: Number(e.target.value) }));
  $('showScore').addEventListener('change', (e) => send('setShowScore', { enabled: e.target.checked }));
  $('openDisplays').addEventListener('click', () => send('openDisplays'));
  $('closeDisplays').addEventListener('click', () => send('closeDisplays'));

  // Title
  function startTitleEdit() {
    editingTitle = true;
    $('titleInput').value = state.eventTitle;
    render();
    $('titleInput').focus();
  }
  function finishTitleEdit() {
    if (!editingTitle) return;
    editingTitle = false;
    $('titleInput').blur();
    render();
  }
  $('editTitle').addEventListener('click', startTitleEdit);
  $('doneTitle').addEventListener('click', finishTitleEdit);
  $('titleInput').addEventListener('input', (e) => send('setText', { field: 'eventTitle', value: e.target.value }));
  $('titleInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') finishTitleEdit(); });

  // Names
  function startNameEdit() {
    editingNames = true;
    $('akaInput').value = state.akaName;
    $('aoInput').value = state.aoName;
    render();
    $('akaInput').focus();
  }
  function finishNameEdit() {
    if (!editingNames) return;
    editingNames = false;
    document.activeElement?.blur();
    render();
  }
  $('editNames').addEventListener('click', startNameEdit);
  $('doneNames').addEventListener('click', finishNameEdit);
  $('akaInput').addEventListener('input', (e) => send('setText', { field: 'akaName', value: e.target.value }));
  $('aoInput').addEventListener('input', (e) => send('setText', { field: 'aoName', value: e.target.value }));
  for (const id of ['akaInput', 'aoInput']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') finishNameEdit(); });
  }

  // Score
  for (const row of document.querySelectorAll('.score-row')) {
    const side = row.dataset.side;
    for (const button of row.querySelectorAll('[data-points]')) {
      button.addEventListener('click', () => send('addScore', { side, points: Number(button.dataset.points) }));
    }
    row.querySelector('[data-minus]').addEventListener('click', () => send('subtractScore', { side }));
  }
  $('resetScores').addEventListener('click', () => send('resetScores'));
  $('newBout').addEventListener('click', () => send('newBout'));

  // Timer
  for (const button of document.querySelectorAll('[data-duration]')) {
    button.addEventListener('click', () => send('setDuration', { seconds: Number(button.dataset.duration) }));
  }
  $('toggle').addEventListener('click', () => send('toggle'));
  $('reset').addEventListener('click', () => send('reset'));
  $('minus10').addEventListener('click', () => send('adjust', { seconds: -10 }));
  $('plus10').addEventListener('click', () => send('adjust', { seconds: 10 }));

  // Extras
  $('sound').addEventListener('change', (e) => send('setSound', { enabled: e.target.checked }));
  $('testSound').addEventListener('click', () => send('testSound'));
  $('extraTime').addEventListener('click', () => send('extraTime'));
  $('regularTime').addEventListener('click', () => send('regularTime'));
  $('dismissMessage').addEventListener('click', () => send('dismissMessage'));

  // Dialog
  $('modalCancel').addEventListener('click', () => send('cancel'));
  $('modalConfirm').addEventListener('click', () => send('confirm'));

  // Bell
  const bell = $('bell');
  window.karate.onBell(() => {
    bell.pause();
    bell.currentTime = 0;
    bell.play().catch(() => send('bellFailed'));
  });

  // Music: follows the clock — fades in while running, fades out on pause, rewinds on reset and time up.
  const MIME = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
    oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
  };
  const FADE_SECONDS = 0.8;
  const music = $('music');
  let musicVersion = 0;
  let musicReady = false;
  let musicMode = null;
  let musicWanted = false;
  let rewindPending = false;
  let fadeTimer = null;
  let audioContext = null;
  let gain = null;

  $('withMusic').addEventListener('click', () => send('setMusicEnabled', { enabled: true }));
  $('countdownOnly').addEventListener('click', () => send('setMusicEnabled', { enabled: false }));
  $('chooseMusic').addEventListener('click', () => send('chooseMusic'));
  $('clearMusic').addEventListener('click', () => send('clearMusic'));
  music.addEventListener('error', () => { if (musicReady) { musicReady = false; send('musicFailed'); } });

  function rampTo(target) {
    if (!gain) {
      audioContext = new AudioContext();
      gain = audioContext.createGain();
      gain.gain.value = 0;
      audioContext.createMediaElementSource(music).connect(gain).connect(audioContext.destination);
    }
    audioContext.resume();
    const now = audioContext.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + FADE_SECONDS);
  }

  function fadeIn() {
    clearTimeout(fadeTimer);
    if (rewindPending) { music.currentTime = 0; rewindPending = false; }
    rampTo(1);
    if (music.paused) {
      music.play().catch((error) => {
        if (error.name === 'AbortError' || !musicReady) return;
        musicReady = false;
        send('musicFailed');
      });
    }
  }

  function fadeOut({ rewind = false } = {}) {
    clearTimeout(fadeTimer);
    if (rewind) rewindPending = true;
    if (music.paused) {
      if (rewindPending) { music.currentTime = 0; rewindPending = false; }
      return;
    }
    rampTo(0);
    fadeTimer = setTimeout(() => {
      music.pause();
      if (rewindPending) { music.currentTime = 0; rewindPending = false; }
    }, FADE_SECONDS * 1000);
  }

  function unloadMusic() {
    clearTimeout(fadeTimer);
    musicReady = false;
    musicWanted = false;
    rewindPending = false;
    music.pause();
    if (music.src) URL.revokeObjectURL(music.src);
    music.removeAttribute('src');
    music.load();
  }

  async function loadMusic(version) {
    unloadMusic();
    const track = await window.karate.getMusic();
    if (version !== musicVersion) return;
    if (!track) return;
    if (track.error) { send('musicFailed'); return; }
    const blob = new Blob([track.data], { type: MIME[track.extension] ?? 'audio/mpeg' });
    music.src = URL.createObjectURL(blob);
    musicReady = true;
    syncMusic();
  }

  function syncMusic() {
    const s = state;
    if (s.music.version !== musicVersion) {
      musicVersion = s.music.version;
      loadMusic(musicVersion);
    }
    if (s.mode !== musicMode) {
      if (musicReady && (s.mode === 'ready' || s.mode === 'finished')) {
        musicWanted = false;
        fadeOut({ rewind: true });
      }
      musicMode = s.mode;
    }
    const shouldPlay = musicReady && s.music.enabled && s.mode === 'running';
    if (shouldPlay !== musicWanted) {
      musicWanted = shouldPlay;
      if (shouldPlay) fadeIn(); else fadeOut();
    }
  }

  function fillScreens(select, screens, selectedID) {
    const signature = JSON.stringify(screens);
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...screens.map((s) => new Option(s.name, String(s.id))));
      select.dataset.signature = signature;
    }
    select.value = String(selectedID);
  }

  function render() {
    const s = state;
    const d = KarateView.derive(s);
    const running = s.mode === 'running';
    const anyOpen = s.timerDisplayOpen || s.scoreDisplayOpen;

    renderTimer(s);
    renderScore(s);
    $('scorePreview').hidden = !s.showScore;

    fillScreens($('timerScreen'), s.screens, s.timerScreenID);
    fillScreens($('scoreScreen'), s.screens, s.scoreScreenID);
    $('showScore').checked = s.showScore;
    $('scoreScreenField').hidden = !s.showScore;
    $('openDisplays').textContent = s.showScore ? '▣ Open timer + score screens' : '▢ Open timer screen';
    $('openDisplays').hidden = anyOpen;
    $('closeDisplays').hidden = !anyOpen;

    $('titleView').hidden = editingTitle;
    $('titleEdit').hidden = !editingTitle;
    $('titleText').textContent = d.title;

    $('scoreSection').hidden = !s.showScore;
    $('editNames').hidden = editingNames;
    $('doneNames').hidden = !editingNames;
    $('nameEditor').hidden = !editingNames;
    $('akaLabel').textContent = d.akaName;
    $('aoLabel').textContent = d.aoName;
    $('akaValue').textContent = String(s.akaScore);
    $('aoValue').textContent = String(s.aoScore);

    $('extraBadge').hidden = s.stage !== 'overtime';
    for (const button of document.querySelectorAll('[data-duration]')) {
      const seconds = Number(button.dataset.duration);
      button.classList.toggle('selected', s.stage === 'regular' && seconds === s.regularDuration);
      button.disabled = running || s.stage === 'overtime';
    }

    $('toggle').textContent = `${running ? '❚❚' : '▶'}  ${d.buttonTitle}`;
    $('toggle').disabled = s.mode === 'finished';
    $('minus10').disabled = running;
    $('plus10').disabled = running;

    $('sound').checked = s.soundEnabled;
    $('withMusic').classList.toggle('selected', s.music.enabled);
    $('countdownOnly').classList.toggle('selected', !s.music.enabled);
    $('musicPicker').hidden = !s.music.enabled;
    $('musicName').textContent = s.music.name;
    $('clearMusic').hidden = !s.music.hasSelection;
    syncMusic();
    $('extraTime').hidden = !(s.stage === 'regular' && !running);
    $('extraTime').textContent = `Need extra time? Load ${format(s.overtimeDuration)}`;
    $('regularTime').hidden = s.stage !== 'overtime';
    $('regularTime').disabled = running;
    $('regularTime').textContent = `← Back to regular (${format(s.regularDuration)})`;

    $('message').hidden = !s.message;
    $('messageText').textContent = s.message ?? '';

    const keys = s.showScore
      ? 'Space start/pause · R reset · 1–9 minutes (paused) · Q/W/E AKA · I/O/P SHIRO · F displays'
      : 'Space start/pause · R reset · 1–9 minutes (paused) · F displays';
    $('help').textContent = s.keepingAwake ? `Keeping PC awake · ${keys}` : keys;

    const modal = $('modal');
    const wasOpen = !modal.hidden;
    modal.hidden = !s.pending;
    if (s.pending) {
      $('modalTitle').textContent = s.pending.title;
      $('modalDetail').textContent = s.pending.detail;
      $('modalConfirm').textContent = s.pending.button;
      if (!wasOpen) $('modalConfirm').focus();
    }
  }

  window.karate.onState((next) => { state = next; render(); });
  state = await window.karate.getState();
  render();
})();
