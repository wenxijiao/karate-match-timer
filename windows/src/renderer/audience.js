'use strict';

(async () => {
  const role = new URLSearchParams(location.search).get('role');
  const container = document.getElementById('display');
  const render = role === 'score'
    ? KarateView.createScoreView(container, true)
    : KarateView.createTimerView(container, true);
  document.title = role === 'score' ? 'Score Display' : 'Timer Display';

  let pending = false;
  KarateView.installShortcuts(() => pending);
  const update = (state) => { pending = Boolean(state.pending); render(state); };
  window.karate.onState(update);
  update(await window.karate.getState());
})();
