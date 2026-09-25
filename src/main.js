import {
  formatContext,
  formatCutoff,
  formatDuration,
  formatIndex,
  formatListedDate,
  formatParams,
  formatPromptPrice,
  formatReasoning,
  modelBlurb,
  modelPageUrl,
  modelProvider,
  prepareModels,
} from './models.js';
import { createDeck } from './quiz.js';
import { applyAnswer, freshRun } from './run.js';
import { pageShareUrl, streakShareText } from './share.js';
import { cleanName, loadLeaderboard, saveScore } from './leaderboard.js';
import './style.css';

const MODELS_URL = 'https://openrouter.ai/api/v1/models?sort=coding-high-to-low';
const app = document.querySelector('#app');

const state = {
  view: 'home',
  loading: false,
  error: '',
  deck: null,
  question: null,
  questionNumber: 1,
  picked: null,
  lives: 3,
  streak: 0,
  bestStreak: 0,
  totalCorrect: 0,
  history: [],
  startedAt: 0,
  durationMs: 0,
  saved: false,
  savedName: '',
  highlightId: null,
  nameError: '',
  shareNote: '',
};

let shareTimer = 0;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child);
  }
  return node;
}

function citation() {
  return el('p', { class: 'cite', text: 'Live from OpenRouter · Artificial Analysis indices when available' });
}

function leaderboard(entries) {
  const block = el('section', {}, [
    el('div', { class: 'section-title' }, [
      el('h2', { text: 'Leaderboard' }),
      el('span', { text: 'This browser' }),
    ]),
  ]);

  if (!entries.length) {
    block.append(el('p', { class: 'empty', text: 'No streaks yet. Play a round to claim the first spot.' }));
    return block;
  }

  const list = el('ol', { class: 'board' });
  entries.forEach((entry, index) => {
    const item = el('li', { class: entry.id === state.highlightId ? 'mine' : '' }, [
      el('span', { class: 'rank', text: String(index + 1) }),
      el('span', { class: 'name', text: entry.name }),
      el('span', {
        class: 'points',
        text: String(entry.score),
        'aria-label': `${entry.score} in a row`,
        title: `${entry.score} in a row${entry.totalCorrect != null ? ` · ${entry.totalCorrect} correct` : ''}`,
      }),
      el('span', { class: 'meta', text: formatDuration(entry.durationMs) }),
    ]);
    list.append(item);
  });
  block.append(list);
  return block;
}

function renderHome() {
  const root = el('div', {}, [
    el('header', { class: 'brand' }, [
      el('div', { class: 'mark', 'aria-hidden': 'true', text: 'OR' }),
      el('div', {}, [
        el('h1', { text: 'OpenRouter Model Quiz' }),
        el('p', { class: 'subtitle', text: 'Test how well you know OpenRouter models' }),
      ]),
    ]),
    el('section', { class: 'panel' }, [
      el('button', {
        class: 'play',
        type: 'button',
        text: state.loading ? 'Loading live models…' : 'Play',
        disabled: state.loading,
        onClick: startGame,
      }),
      el('p', {
        class: 'lede',
        text: 'Three lives. Build your longest streak from the live catalog. A wrong answer costs a life and resets the streak.',
      }),
      state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    ]),
    leaderboard(loadLeaderboard()),
    citation(),
  ]);
  app.replaceChildren(root);
}

const INPUT_CHIPS = [
  ['text', 'Text'],
  ['image', 'Image'],
  ['video', 'Video'],
  ['file', 'File'],
  ['audio', 'Audio'],
];

const SCORE_FIELDS = [
  ['coding', 'Coding'],
  ['intelligence', 'Intelligence'],
  ['agentic', 'Agentic'],
];

function learnRow(label, valueNode, { emphasis = false, block = false, note = '' } = {}) {
  const classes = ['learn-row'];
  if (emphasis) classes.push('emphasis');
  if (block) classes.push('block');
  return el('div', { class: classes.join(' ') }, [
    el('span', { class: 'learn-label', text: label }),
    valueNode,
    note ? el('span', { class: 'learn-note', text: note }) : null,
  ]);
}

function learnValue(text) {
  return el('span', { class: 'learn-value', text });
}

function modalityChips(model, kind) {
  const have = new Set(model.modalities);
  const known = new Set(INPUT_CHIPS.map(([id]) => id));
  const wrap = el('div', { class: 'chips' });
  for (const [id, label] of INPUT_CHIPS) {
    const classes = ['chip', have.has(id) ? 'on' : 'off'];
    if ((kind === 'vision' && id === 'image') || (kind === 'video' && id === 'video')) classes.push('emphasis');
    wrap.append(el('span', { class: classes.join(' '), text: label }));
  }
  for (const extra of model.modalities) {
    if (known.has(extra)) continue;
    wrap.append(el('span', { class: 'chip on', text: extra }));
  }
  return wrap;
}

function priceText(value) {
  if (value == null) return 'Not listed';
  if (value === 0) return 'Free';
  return formatPromptPrice(value);
}

function learnCard(model, question, visibility, winner) {
  const kind = question.kind;
  const rows = el('div', { class: 'learn-rows' });
  rows.append(
    learnRow('Size', learnValue(model.params != null ? `${formatParams(model.params)} parameters` : 'Not listed'), {
      emphasis: kind === 'params',
    }),
  );
  rows.append(
    learnRow('Listed on OpenRouter', learnValue(formatListedDate(model.created) || 'Not listed'), {
      note: 'Catalog date, not a lab launch',
    }),
  );
  if (visibility.cutoff) {
    rows.append(
      learnRow(
        'Knowledge cutoff',
        learnValue(model.knowledgeCutoff ? formatCutoff(model.knowledgeCutoff) || model.knowledgeCutoff : 'Not listed'),
      ),
    );
  }
  rows.append(
    learnRow('Inputs', modalityChips(model, kind), {
      emphasis: kind === 'vision' || kind === 'video',
      block: true,
    }),
  );
  rows.append(
    learnRow('Context', learnValue(model.context != null ? formatContext(model.context) : 'Not listed'), {
      emphasis: kind === 'context',
    }),
  );
  rows.append(learnRow('Prompt / 1M', learnValue(priceText(model.promptPrice)), { emphasis: kind === 'price' }));
  rows.append(learnRow('Completion / 1M', learnValue(priceText(model.completionPrice))));

  const scores = SCORE_FIELDS.filter(([key]) => visibility[key]);
  if (scores.length) {
    rows.append(el('p', { class: 'learn-section', text: 'Artificial Analysis' }));
    for (const [key, label] of scores) {
      rows.append(
        learnRow(label, learnValue(model[key] != null ? formatIndex(model[key]) : 'Not listed'), {
          emphasis: kind === key,
        }),
      );
    }
  }

  rows.append(learnRow('Reasoning', learnValue(formatReasoning(model))));

  const blurb = modelBlurb(model.description);
  return el('article', { class: winner ? 'learn-card winner' : 'learn-card' }, [
    el('div', { class: 'learn-head' }, [
      el('div', { class: 'learn-id' }, [
        el('p', { class: 'learn-provider', text: modelProvider(model.id) }),
        el('h3', { class: 'learn-name', text: model.name }),
      ]),
      winner ? el('span', { class: 'winner-tag', text: 'Winner' }) : null,
    ]),
    el('a', {
      class: 'learn-link',
      href: modelPageUrl(model.id),
      target: '_blank',
      rel: 'noopener noreferrer',
      text: 'Open on OpenRouter ↗',
      'aria-label': `Open ${model.name} on OpenRouter`,
    }),
    rows,
    blurb ? el('p', { class: 'learn-blurb', text: blurb }) : null,
  ]);
}

function learnCards(question) {
  const models = Array.isArray(question.models) ? question.models : [];
  if (!models.length) {
    return question.fact ? el('p', { class: 'learn-blurb', text: question.fact }) : null;
  }
  const visibility = {
    cutoff: models.some((model) => model.knowledgeCutoff),
    coding: models.some((model) => model.coding != null),
    intelligence: models.some((model) => model.intelligence != null),
    agentic: models.some((model) => model.agentic != null),
  };
  const grid = el('div', {
    class: models.length > 1 ? 'learn-grid' : 'learn-grid single',
  });
  models.forEach((model, index) => {
    const winner = models.length > 1 && String(index) === question.answerId;
    grid.append(learnCard(model, question, visibility, winner));
  });
  return el('div', { class: 'learn-block', 'aria-live': 'polite' }, [
    el('h2', { class: 'learn-heading', text: 'Learn' }),
    grid,
  ]);
}

function livesRow(lives, label) {
  const row = el('p', {
    class: 'lives',
    'aria-label': label || `${lives} ${lives === 1 ? 'life' : 'lives'} left`,
  });
  for (let i = 0; i < 3; i += 1) {
    const full = i < lives;
    row.append(el('span', { class: full ? 'heart full' : 'heart empty', 'aria-hidden': 'true', text: full ? '❤️' : '💔' }));
  }
  return row;
}

function hudStat(label, value, align) {
  return el('div', { class: align ? `hud-stat ${align}` : 'hud-stat' }, [
    el('p', { class: 'kicker', text: label }),
    el('p', { class: 'hud-num', text: String(value) }),
  ]);
}

function renderQuiz() {
  const question = state.question;
  const answered = state.picked != null;
  const correct = answered && state.picked === question.answerId;

  const choices = el('div', { class: 'choices' });
  for (const choice of question.choices) {
    const classes = ['choice'];
    if (answered && choice.id === question.answerId) classes.push('correct');
    if (answered && choice.id === state.picked && choice.id !== question.answerId) classes.push('incorrect');
    choices.append(
      el('button', {
        class: classes.join(' '),
        type: 'button',
        text: choice.label,
        disabled: answered,
        onClick: () => choose(choice.id),
      }),
    );
  }

  const cardChildren = [
    el('p', { class: 'prompt', id: 'question-title', tabindex: '-1', text: question.prompt }),
    question.detail ? el('p', { class: 'detail', text: question.detail }) : null,
    choices,
  ];

  if (answered) {
    cardChildren.push(
      el('div', { class: `feedback ${correct ? 'good' : 'bad'}`, role: 'status' }, [
        el('strong', { text: correct ? 'Correct' : 'Incorrect' }),
        correct
          ? null
          : el('p', {
              text: state.lives > 0 ? 'Streak reset. A life lost.' : 'No lives left.',
            }),
      ]),
      learnCards(question),
      el('button', {
        class: 'next',
        type: 'button',
        id: 'next-question',
        text: state.lives > 0 ? 'Next question' : 'See score',
        onClick: advance,
      }),
    );
  }

  const root = el('div', {}, [
    el('div', { class: 'hud' }, [
      hudStat('Streak', state.streak),
      livesRow(state.lives),
      hudStat('Best', state.bestStreak, 'best'),
    ]),
    el('p', { class: 'kicker question-kicker', text: `Question ${state.questionNumber}` }),
    el('section', { class: 'panel' }, cardChildren),
    citation(),
  ]);
  app.replaceChildren(root);
  window.scrollTo(0, 0);
  if (answered) document.getElementById('next-question')?.focus({ preventScroll: true });
  else document.getElementById('question-title')?.focus({ preventScroll: true });
}

function glyphRow() {
  if (!state.history.length) return null;
  const correct = state.history.filter((mark) => mark === 'correct').length;
  const wrong = state.history.length - correct;
  const row = el('div', {
    class: 'glyphs',
    role: 'img',
    'aria-label': `${correct} correct, ${wrong} missed`,
  });
  for (const mark of state.history) {
    row.append(el('span', { class: mark === 'correct' ? 'glyph hit' : 'glyph miss', 'aria-hidden': 'true' }));
  }
  return row;
}

function renderResults() {
  const livesUsed = 3 - state.lives;
  const form = state.saved
    ? el('div', {}, [
        el('p', { class: 'saved-note', text: `Saved as ${state.savedName}.` }),
        el('button', { class: 'play', type: 'button', text: 'Play again', onClick: startGame }),
      ])
    : el('form', { class: 'form', onSubmit: onSave }, [
        el('label', {}, [
          document.createTextNode('Display name'),
          el('input', {
            type: 'text',
            name: 'displayName',
            maxlength: '24',
            autocomplete: 'nickname',
            placeholder: 'Your name',
            required: true,
          }),
        ]),
        state.nameError ? el('p', { class: 'error', role: 'alert', text: state.nameError }) : null,
        el('button', { class: 'play', type: 'submit', text: 'Save to leaderboard' }),
        el('button', { class: 'ghost', type: 'button', text: 'Play again', onClick: startGame }),
      ]);

  const root = el('div', { class: 'results' }, [
    el('p', { class: 'kicker center', text: 'OpenRouter Model Quiz' }),
    el('section', { class: 'panel game-over' }, [
      el('div', { class: 'score-hero' }, [
        el('p', { class: 'label', text: 'Best streak' }),
        el('p', { class: 'score', text: String(state.bestStreak) }),
        el('p', { class: 'streak-label', text: 'in a row' }),
        livesRow(state.lives, `${livesUsed} ${livesUsed === 1 ? 'life' : 'lives'} used`),
        el('p', {
          class: 'lede',
          text: `${state.totalCorrect} correct · ${livesUsed} ${livesUsed === 1 ? 'life' : 'lives'} used · ${formatDuration(state.durationMs)}`,
        }),
      ]),
      glyphRow(),
      el('button', {
        class: state.shareNote ? 'share done' : 'share',
        type: 'button',
        id: 'share-score',
        text: state.shareNote || 'Share',
        onClick: onShare,
      }),
      form,
      state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    ]),
    leaderboard(loadLeaderboard()),
    citation(),
  ]);
  app.replaceChildren(root);
  window.scrollTo(0, 0);
  if (state.shareNote) root.querySelector('#share-score')?.focus({ preventScroll: true });
  else root.querySelector('input[name="displayName"]')?.focus({ preventScroll: true });
}

function render() {
  app.classList.toggle('wide', state.view === 'quiz');
  if (state.view === 'quiz') renderQuiz();
  else if (state.view === 'results') renderResults();
  else renderHome();
}

function adoptRun(run) {
  state.lives = run.lives;
  state.streak = run.streak;
  state.bestStreak = run.bestStreak;
  state.totalCorrect = run.totalCorrect;
  state.history = run.history;
}

function finishRun() {
  if (!state.durationMs) state.durationMs = Math.max(0, performance.now() - state.startedAt);
  state.view = 'results';
  state.picked = null;
}

async function startGame() {
  state.loading = true;
  state.error = '';
  state.view = 'home';
  state.shareNote = '';
  window.clearTimeout(shareTimer);
  render();
  try {
    const response = await fetch(MODELS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OpenRouter responded with ${response.status}.`);
    const payload = await response.json();
    const models = prepareModels(Array.isArray(payload) ? payload : payload?.data);
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
    const deck = createDeck(models, seed);
    state.deck = deck;
    state.question = deck.nextQuestion();
    state.questionNumber = 1;
    state.picked = null;
    adoptRun(freshRun());
    state.startedAt = performance.now();
    state.durationMs = 0;
    state.saved = false;
    state.savedName = '';
    state.highlightId = null;
    state.nameError = '';
    state.view = 'quiz';
  } catch (error) {
    state.error = error?.message || 'Could not load models from OpenRouter.';
    state.view = 'home';
  } finally {
    state.loading = false;
    render();
  }
}

function choose(choiceId) {
  if (state.picked != null || state.view !== 'quiz' || !state.question) return;
  const question = state.question;
  state.picked = choiceId;
  const run = applyAnswer(
    {
      lives: state.lives,
      streak: state.streak,
      bestStreak: state.bestStreak,
      totalCorrect: state.totalCorrect,
      history: state.history,
    },
    choiceId === question.answerId,
  );
  adoptRun(run);
  if (run.over) state.durationMs = Math.max(0, performance.now() - state.startedAt);
  render();
}

function advance() {
  if (state.view !== 'quiz') return;
  if (state.lives <= 0) {
    finishRun();
    render();
    return;
  }
  try {
    state.question = state.deck.nextQuestion();
    state.questionNumber += 1;
    state.picked = null;
  } catch (error) {
    state.error = error?.message || 'Could not build another question.';
    finishRun();
  }
  render();
}

function onSave(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const name = cleanName(data.get('displayName'));
  if (!name) {
    state.nameError = 'Enter a display name.';
    render();
    return;
  }
  const { entry } = saveScore({
    name,
    score: state.bestStreak,
    totalCorrect: state.totalCorrect,
    durationMs: state.durationMs,
  });
  state.saved = true;
  state.savedName = name;
  state.highlightId = entry.id;
  state.nameError = '';
  render();
}

function currentPageUrl() {
  return pageShareUrl(window.location.href);
}

function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (ok) resolve();
    else reject(new Error('copy failed'));
  });
}

function flashShare(note) {
  state.shareNote = note;
  const button = document.getElementById('share-score');
  if (button && state.view === 'results') {
    button.textContent = note;
    button.classList.add('done');
    window.clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => {
      state.shareNote = '';
      const current = document.getElementById('share-score');
      if (!current || state.view !== 'results') return;
      current.textContent = 'Share';
      current.classList.remove('done');
    }, 1600);
    return;
  }
  render();
}

async function onShare() {
  const text = streakShareText(state.bestStreak, currentPageUrl());
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      flashShare('Shared');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    await copyText(text);
    flashShare('Copied!');
  } catch {
    flashShare('Copy failed');
  }
}

document.addEventListener('keydown', (event) => {
  if (state.view !== 'quiz') return;
  const question = state.question;
  if (!question) return;
  if (state.picked == null) {
    const key = event.key.toLowerCase();
    if (key === '1') choose(question.choices[0].id);
    if (key === '2') choose(question.choices[1].id);
    if (question.kind === 'vision' || question.kind === 'video') {
      if (key === 'y') choose('yes');
      if (key === 'n') choose('no');
    }
    return;
  }
  if (event.key === 'Enter') {
    if (event.target instanceof Element && event.target.closest('a')) return;
    advance();
  }
});

render();
