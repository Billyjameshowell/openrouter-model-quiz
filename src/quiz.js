import { formatContext, formatIndex, formatParams, formatPromptPrice } from './models.js';

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const CORE_SLOTS = [
  'params',
  'params',
  'coding',
  'coding',
  'vision-yes',
  'vision-no',
  'video-yes',
  'video-no',
];

const FALLBACK_SLOTS = [
  'coding',
  'params',
  'context',
  'intelligence',
  'price',
  'vision-yes',
  'vision-no',
  'video-yes',
  'video-no',
];

function fillerSlots(rng) {
  const options = ['context', 'intelligence', 'price'];
  const first = Math.floor(rng() * options.length);
  let second = Math.floor(rng() * (options.length - 1));
  if (second >= first) second += 1;
  return [options[first], options[second]];
}

function samplePair(models, read, rng, seenPairs, seenModels, reject) {
  const pool = models.filter((model) => read(model) != null);
  if (pool.length < 2) return null;

  const pick = (requireFresh) => {
    const source = requireFresh ? pool.filter((model) => !seenModels.has(model.id)) : pool;
    if (source.length < 2) return null;
    const leftIndex = Math.floor(rng() * source.length);
    let rightIndex = Math.floor(rng() * (source.length - 1));
    if (rightIndex >= leftIndex) rightIndex += 1;
    const left = source[leftIndex];
    const right = source[rightIndex];
    const key = [left.id, right.id].sort().join('\0');
    if (seenPairs.has(key)) return null;
    if (read(left) === read(right)) return null;
    if (reject && reject(left, right)) return null;
    return [left, right, key];
  };

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = pick(true);
    if (found) return found;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = pick(false);
    if (found) return found;
  }
  return null;
}

function comparisonQuestion({ kind, prompt, models, read, describe, higher, rng, seenPairs, seenModels }) {
  const picked = samplePair(
    models,
    read,
    rng,
    seenPairs,
    seenModels,
    (left, right) => describe(left) === describe(right),
  );
  if (!picked) return null;
  const [first, second, key] = picked;
  seenPairs.add(key);
  seenModels.add(first.id);
  seenModels.add(second.id);

  const ordered = rng() < 0.5 ? [first, second] : [second, first];
  const winner = higher
    ? read(ordered[0]) > read(ordered[1])
      ? '0'
      : '1'
    : read(ordered[0]) < read(ordered[1])
      ? '0'
      : '1';

  return {
    kind,
    prompt,
    detail: null,
    choices: ordered.map((model, index) => ({ id: String(index), label: model.name })),
    answerId: winner,
    fact: `${ordered[0].name} — ${describe(ordered[0])} vs ${ordered[1].name} — ${describe(ordered[1])}`,
    models: ordered,
  };
}

function yesNoQuestion({ kind, prompt, models, flag, want, rng, seenModels, fact }) {
  const pool = models.filter((model) => model[flag] === want);
  if (!pool.length) return null;
  const fresh = pool.filter((model) => !seenModels.has(model.id));
  const source = fresh.length ? fresh : pool;
  const model = source[Math.floor(rng() * source.length)];
  seenModels.add(model.id);
  const modalities = model.modalities.length ? model.modalities.join(', ') : 'none listed';
  return {
    kind,
    prompt,
    detail: model.name,
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    answerId: want ? 'yes' : 'no',
    fact: fact(model, modalities),
    models: [model],
  };
}

function buildSlot(slot, models, rng, seenPairs, seenModels) {
  if (slot === 'params') {
    return comparisonQuestion({
      kind: 'params',
      prompt: 'Which model has more parameters?',
      models,
      read: (model) => model.params,
      describe: (model) => `${formatParams(model.params)} parameters`,
      higher: true,
      rng,
      seenPairs,
      seenModels,
    });
  }
  if (slot === 'coding') {
    return comparisonQuestion({
      kind: 'coding',
      prompt: 'Which model has the higher Artificial Analysis coding index?',
      models,
      read: (model) => model.coding,
      describe: (model) => `coding index ${formatIndex(model.coding)}`,
      higher: true,
      rng,
      seenPairs,
      seenModels,
    });
  }
  if (slot === 'context') {
    return comparisonQuestion({
      kind: 'context',
      prompt: 'Which model has the larger context window?',
      models,
      read: (model) => model.context,
      describe: (model) => formatContext(model.context),
      higher: true,
      rng,
      seenPairs,
      seenModels,
    });
  }
  if (slot === 'intelligence') {
    return comparisonQuestion({
      kind: 'intelligence',
      prompt: 'Which model has the higher Artificial Analysis intelligence index?',
      models,
      read: (model) => model.intelligence,
      describe: (model) => `intelligence index ${formatIndex(model.intelligence)}`,
      higher: true,
      rng,
      seenPairs,
      seenModels,
    });
  }
  if (slot === 'price') {
    return comparisonQuestion({
      kind: 'price',
      prompt: 'Which model has the cheaper prompt price?',
      models,
      read: (model) => model.promptPrice,
      describe: (model) => `prompt price ${formatPromptPrice(model.promptPrice)}`,
      higher: false,
      rng,
      seenPairs,
      seenModels,
    });
  }
  if (slot === 'vision-yes' || slot === 'vision-no') {
    return yesNoQuestion({
      kind: 'vision',
      prompt: 'Does this model support vision (image input)?',
      models,
      flag: 'vision',
      want: slot === 'vision-yes',
      rng,
      seenModels,
      fact: (model, modalities) =>
        model.vision
          ? `${model.name} accepts image input (${modalities}).`
          : `${model.name} does not accept image input (${modalities}).`,
    });
  }
  if (slot === 'video-yes' || slot === 'video-no') {
    return yesNoQuestion({
      kind: 'video',
      prompt: 'Does this model support video input?',
      models,
      flag: 'video',
      want: slot === 'video-yes',
      rng,
      seenModels,
      fact: (model, modalities) =>
        model.video
          ? `${model.name} accepts video input (${modalities}).`
          : `${model.name} does not accept video input (${modalities}).`,
    });
  }
  return null;
}

function tidyFact(question) {
  if (!question) return question;
  return {
    ...question,
    fact: question.fact.replace(/:\s+vs/g, ' vs').replace(/ {2,}/g, ' ').trim(),
  };
}

export function generateQuiz(models, seed) {
  const rng = mulberry32(seed);
  const seenPairs = new Set();
  const seenModels = new Set();
  const slots = [...CORE_SLOTS, ...fillerSlots(rng)];
  const questions = [];

  const take = (slot) => tidyFact(buildSlot(slot, models, rng, seenPairs, seenModels));

  for (const slot of slots) {
    let question = take(slot);
    if (!question) {
      for (const alt of shuffle(FALLBACK_SLOTS, rng)) {
        question = take(alt);
        if (question) break;
      }
    }
    if (question) questions.push(question);
  }

  let guard = 0;
  while (questions.length < 10 && guard < 40) {
    guard += 1;
    const slot = FALLBACK_SLOTS[Math.floor(rng() * FALLBACK_SLOTS.length)];
    const question = take(slot);
    if (question) questions.push(question);
  }

  if (questions.length < 10) {
    throw new Error('Not enough comparable models to build a 10-question quiz.');
  }

  return shuffle(questions, rng).slice(0, 10);
}

const SLOT_BAG = [
  'params',
  'params',
  'coding',
  'coding',
  'context',
  'intelligence',
  'price',
  'vision-yes',
  'vision-no',
  'video-yes',
  'video-no',
];

export function createDeck(models, seed) {
  const rng = mulberry32(seed);
  const seenPairs = new Set();
  const seenModels = new Set();
  let queue = [];

  const take = (slot) => tidyFact(buildSlot(slot, models, rng, seenPairs, seenModels));

  const draw = () => {
    if (!queue.length) queue = shuffle(SLOT_BAG, rng);
    const slot = queue.shift();
    let question = take(slot);
    if (!question) {
      for (const alt of shuffle(FALLBACK_SLOTS, rng)) {
        question = take(alt);
        if (question) break;
      }
    }
    return question;
  };

  return {
    nextQuestion() {
      for (let pass = 0; pass < 3; pass += 1) {
        if (pass === 1) seenPairs.clear();
        if (pass === 2) seenModels.clear();
        for (let attempt = 0; attempt < SLOT_BAG.length; attempt += 1) {
          const question = draw();
          if (question) return question;
        }
      }
      throw new Error('Not enough comparable models to continue the quiz.');
    },
  };
}
