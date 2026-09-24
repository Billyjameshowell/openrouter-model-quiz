import { formatDuration, prepareModels } from './models.js';
import { generateQuiz } from './quiz.js';
import { cleanName, loadLeaderboard, saveScore } from './leaderboard.js';
import './style.css';

const MODELS_URL = 'https://openrouter.ai/api/v1/models?sort=coding-high-to-low';
const app = document.querySelector('#app');

const state = {
  view: 'home',
  loading: false,
  error: '',
  questions: [],
  index: 0,
  picked: null,
  correctCount: 0,
  startedAt: 0,
  durationMs: 0,
  saved: false,
  savedName: '',
  highlightId: null,
  nameError: '',
};

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
    block.append(el('p', { class: 'empty', text: 'No scores yet. Play a round to claim the first spot.' }));
    return block;
  }

  const list = el('ol', { class: 'board' });
  entries.forEach((entry, index) => {
    const item = el('li', { class: entry.id === state.highlightId ? 'mine' : '' }, [
      el('span', { class: 'rank', text: String(index + 1) }),
      el('span', { class: 'name', text: entry.name }),
      el('span', { class: 'points', text: `${entry.score}/10` }),
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
        text: '10 questions from the live catalog. Score out of 10, then save a display name.',
      }),
      state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    ]),
    leaderboard(loadLeaderboard()),
    citation(),
  ]);
  app.replaceChildren(root);
}

function renderQuiz() {
  const question = state.questions[state.index];
  const answered = state.picked != null;
  const correct = answered && state.picked === question.answerId;
  const progress = ((state.index + 1) / 10) * 100;

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
        el('p', { text: question.fact }),
      ]),
      el('button', {
        class: 'next',
        type: 'button',
        id: 'next-question',
        text: state.index === 9 ? 'See score' : 'Next question',
        onClick: advance,
      }),
    );
  }

  const root = el('div', {}, [
    el('div', { class: 'topbar' }, [
      el('p', { class: 'kicker', text: 'OpenRouter Model Quiz' }),
      el('p', { class: 'kicker', text: `Score ${state.correctCount}` }),
    ]),
    el('p', { class: 'kicker', text: `Question ${state.index + 1} of 10` }),
    el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': '10', 'aria-valuenow': String(state.index + 1) }, [
      el('span', { style: `width:${progress}%` }),
    ]),
    el('section', { class: 'panel' }, cardChildren),
    citation(),
  ]);
  app.replaceChildren(root);
  if (answered) document.getElementById('next-question')?.focus();
  else document.getElementById('question-title')?.focus();
}

function renderResults() {
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

  const root = el('div', {}, [
    el('header', { class: 'brand' }, [
      el('div', { class: 'mark', 'aria-hidden': 'true', text: 'OR' }),
      el('div', {}, [
        el('h1', { text: 'OpenRouter Model Quiz' }),
        el('p', { class: 'subtitle', text: 'Test how well you know OpenRouter models' }),
      ]),
    ]),
    el('section', { class: 'panel' }, [
      el('div', { class: 'score-hero' }, [
        el('p', { class: 'label', text: 'Your score' }),
        el('p', { class: 'score' }, [
          document.createTextNode(String(state.correctCount)),
          el('span', { text: '/10' }),
        ]),
        el('p', { class: 'lede', text: `Finished in ${formatDuration(state.durationMs)}` }),
      ]),
      form,
    ]),
    leaderboard(loadLeaderboard()),
    citation(),
  ]);
  app.replaceChildren(root);
  root.querySelector('input[name="displayName"]')?.focus();
}

function render() {
  if (state.view === 'quiz') renderQuiz();
  else if (state.view === 'results') renderResults();
  else renderHome();
}

async function startGame() {
  state.loading = true;
  state.error = '';
  state.view = 'home';
  render();
  try {
    const response = await fetch(MODELS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OpenRouter responded with ${response.status}.`);
    const payload = await response.json();
    const models = prepareModels(Array.isArray(payload) ? payload : payload?.data);
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
    state.questions = generateQuiz(models, seed);
    state.index = 0;
    state.picked = null;
    state.correctCount = 0;
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
  if (state.picked != null) return;
  const question = state.questions[state.index];
  state.picked = choiceId;
  if (choiceId === question.answerId) state.correctCount += 1;
  if (state.index === state.questions.length - 1) {
    state.durationMs = Math.max(0, performance.now() - state.startedAt);
  }
  render();
}

function advance() {
  if (state.index >= state.questions.length - 1) {
    state.view = 'results';
    state.picked = null;
    render();
    return;
  }
  state.index += 1;
  state.picked = null;
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
    score: state.correctCount,
    durationMs: state.durationMs,
  });
  state.saved = true;
  state.savedName = name;
  state.highlightId = entry.id;
  state.nameError = '';
  render();
}

document.addEventListener('keydown', (event) => {
  if (state.view !== 'quiz') return;
  const question = state.questions[state.index];
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
  if (event.key === 'Enter') advance();
});

render();
