'use strict';

(() => {
  const format = (seconds) => {
    const safe = Number.isFinite(seconds) ? Math.min(5999, Math.max(0, seconds)) : 0;
    const total = Math.ceil(safe);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  const orDefault = (value, fallback) => {
    const trimmed = (value ?? '').trim();
    return trimmed === '' ? fallback : trimmed;
  };

  const derive = (s) => {
    const isWarning = s.mode === 'running' && s.remaining > 0 && s.remaining <= 10;
    return {
      time: format(s.remaining),
      isWarning,
      tone: s.mode === 'finished' ? 'finish' : (isWarning ? 'warning' : 'normal'),
      progress: Math.min(1, Math.max(0, s.remaining / Math.max(1, s.total))),
      status: { ready: 'READY', running: 'RUNNING', paused: 'PAUSED', finished: 'TIME UP' }[s.mode],
      displayMessage: {
        ready: s.stage === 'overtime' ? 'EXTRA TIME READY' : 'READY',
        running: isWarning ? 'FINAL 10 SECONDS' : '',
        paused: 'PAUSED',
        finished: 'TIME UP',
      }[s.mode],
      buttonTitle: { ready: 'Start', running: 'Pause', paused: 'Resume', finished: 'Finished' }[s.mode],
      title: orDefault(s.eventTitle, 'KARATE'),
      akaName: orDefault(s.akaName, 'AKA'),
      aoName: orDefault(s.aoName, 'SHIRO'),
    };
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  function createTimerView(container, audience) {
    const root = el('div', `timer-view${audience ? ' audience' : ''}`);
    const head = el('div', 'tv-head');
    const title = el('span', 'tv-title');
    const status = el('span', 'tv-status');
    head.append(title, status);
    const center = el('div', 'tv-center');
    const extra = el('div', 'tv-extra', 'EXTRA TIME');
    const time = el('div', 'tv-time');
    const message = el('div', 'tv-message');
    center.append(extra, time, message);
    const bar = el('div', 'tv-bar');
    const fill = el('div', 'tv-fill');
    bar.append(fill);
    root.append(head, center, bar);
    container.append(root);

    return (s) => {
      const d = derive(s);
      root.dataset.tone = d.tone;
      root.dataset.mode = s.mode;
      setText(title, d.title);
      setText(status, d.status);
      extra.hidden = s.stage !== 'overtime';
      setText(time, d.time);
      setText(message, d.displayMessage || '\u00a0');
      message.style.visibility = d.displayMessage ? 'visible' : 'hidden';
      fill.style.width = `${d.progress * 100}%`;
    };
  }

  function createScoreView(container, audience) {
    const root = el('div', `score-view${audience ? ' audience' : ''}`);
    const title = el('div', 'sv-title');
    const row = el('div', 'sv-row');
    const block = (side, label) => {
      const node = el('div', `sv-block ${side}`);
      const sideLabel = el('div', 'sv-side', label);
      const name = el('div', 'sv-name');
      const score = el('div', 'sv-score');
      node.append(sideLabel, name, score);
      return { node, name, score };
    };
    const aka = block('aka', 'AKA');
    const shiro = block('shiro', 'SHIRO');
    row.append(aka.node, el('div', 'sv-divider'), shiro.node);
    root.append(title, row);
    container.append(root);

    return (s) => {
      const d = derive(s);
      setText(title, d.title);
      setText(aka.name, d.akaName);
      setText(aka.score, String(s.akaScore));
      setText(shiro.name, d.aoName);
      setText(shiro.score, String(s.aoScore));
    };
  }

  const FORWARDED_CODES = new Set([
    'Space', 'KeyR', 'KeyF', 'Escape', 'KeyQ', 'KeyW', 'KeyE', 'KeyI', 'KeyO', 'KeyP',
  ]);

  const isTextInput = (node) => node instanceof HTMLInputElement && node.type === 'text';

  /** Sends match shortcuts to the main process. `shouldSkip(event)` lets a page keep a key for itself. */
  function installShortcuts(shouldSkip = () => false) {
    document.addEventListener('keydown', (event) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTextInput(event.target) || shouldSkip(event)) return;
      const isDigit = /^[1-9]$/.test(event.key);
      if (!FORWARDED_CODES.has(event.code) && !isDigit) return;
      event.preventDefault();
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      window.karate.key(event.code, event.key);
    });
    // A focused button would otherwise activate on Space release.
    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space' && !isTextInput(event.target)) event.preventDefault();
    });
  }

  window.KarateView = { format, derive, createTimerView, createScoreView, installShortcuts, isTextInput };
})();
