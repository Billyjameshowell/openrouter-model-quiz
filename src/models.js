const MIN_PARAMS = 1e8;

const QTY = '(\\d+(?:\\.\\d+)?)\\s*-?\\s*(trillion|billion|million|[tmb])\\b';

const TOTAL_RULES = [
  {
    re: new RegExp(
      `${QTY}\\s+active\\s+parameters?\\s+out\\s+of\\s+(?:a\\s+total\\s+of\\s+)?${QTY}`,
      'i',
    ),
    at: 3,
  },
  {
    re: new RegExp(
      `activat(?:ing|es)\\s+${QTY}\\s+parameters?\\s+out\\s+of\\s+(?:a\\s+)?total\\s+of\\s+${QTY}`,
      'i',
    ),
    at: 3,
  },
  {
    re: new RegExp(
      `${QTY}\\s+activat\\w*\\s+parameters?\\s*\\(\\s*${QTY}\\s+total`,
      'i',
    ),
    at: 3,
  },
  {
    re: new RegExp(`activates\\s+${QTY}\\s+of\\s+its\\s+${QTY}\\s+parameters?`, 'i'),
    at: 3,
  },
  {
    re: new RegExp(`${QTY}\\s+total\\s*/\\s*${QTY}\\s+active`, 'i'),
    at: 1,
  },
  {
    re: new RegExp(
      `${QTY}\\s+parameters?\\s*,\\s*with\\s+${QTY}\\s+parameters?\\s+activat`,
      'i',
    ),
    at: 1,
  },
  {
    re: new RegExp(`\\(${QTY}\\s+parameters?\\s*,\\s*${QTY}\\s+active`, 'i'),
    at: 1,
  },
  {
    re: new RegExp(`total\\s+parameter\\s+count\\s+of\\s+${QTY}`, 'i'),
    at: 1,
  },
  {
    re: new RegExp(`${QTY}\\s+total\\s+parameters?`, 'i'),
    at: 1,
  },
];

function toCount(numStr, unitStr) {
  const n = Number(numStr);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = unitStr.toLowerCase();
  const mult =
    unit === 't' || unit === 'trillion'
      ? 1e12
      : unit === 'b' || unit === 'billion'
        ? 1e9
        : unit === 'm' || unit === 'million'
          ? 1e6
          : null;
  if (!mult) return null;
  const count = n * mult;
  if (count < MIN_PARAMS || count > 1e16) return null;
  return count;
}

function readQty(match, at) {
  return toCount(match[at], match[at + 1]);
}

function mentionIsActive(text, start, end) {
  const before = text.slice(Math.max(0, start - 48), start).toLowerCase();
  const after = text.slice(end, end + 36).toLowerCase();
  if (/\bactivat(?:e|es|ed|ing)\b[\w\s*]{0,24}$/.test(before)) return true;
  if (/^\s*\*{0,2}\s*activ/.test(after)) return true;
  return false;
}

function extractFromDescription(description) {
  for (const rule of TOTAL_RULES) {
    const match = description.match(rule.re);
    if (!match) continue;
    const count = readQty(match, rule.at);
    if (count) return count;
  }

  const fallback = new RegExp(`${QTY}\\s*-?\\s*parameters?`, 'gi');
  const counts = [];
  let match;
  while ((match = fallback.exec(description))) {
    if (mentionIsActive(description, match.index, match.index + match[0].length)) continue;
    const count = readQty(match, 1);
    if (count) counts.push(count);
  }
  if (!counts.length) return null;
  return Math.max(...counts);
}

function extractFromName(name) {
  const moe = name.match(
    /(\d+(?:\.\d+)?)\s*([tmb])\s*-?\s*a\s*(\d+(?:\.\d+)?)[tmb]\b/i,
  );
  if (moe) {
    const total = toCount(moe[1], moe[2]);
    if (total) return total;
  }

  const re = /(\d+(?:\.\d+)?)([tmb])\b/gi;
  const found = [];
  let match;
  while ((match = re.exec(name))) {
    const before = name.slice(Math.max(0, match.index - 2), match.index);
    if (/a$/i.test(before)) continue;
    if (/\dx$/i.test(before)) continue;
    const count = toCount(match[1], match[2]);
    if (count) found.push(count);
  }
  if (!found.length) return null;
  return Math.max(...found);
}

export function extractParamCount(name, description) {
  if (description) {
    const fromDescription = extractFromDescription(description);
    if (fromDescription) return fromDescription;
  }
  if (name) return extractFromName(name);
  return null;
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function positiveNumber(value) {
  const n = finiteNumber(value);
  return n != null && n > 0 ? n : null;
}

export function prepareModels(list) {
  const raw = Array.isArray(list) ? list : [];
  const ids = new Set(raw.map((model) => model?.id).filter((id) => typeof id === 'string' && id));

  return raw
    .filter((model) => {
      if (!model || typeof model.id !== 'string' || !model.id) return false;
      if (/:(?:batch|free)$/.test(model.id)) {
        const base = model.id.replace(/:(?:batch|free)$/, '');
        if (ids.has(base)) return false;
      }
      return true;
    })
    .map((model) => {
      const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim() : model.id;
      const modalities = Array.isArray(model.architecture?.input_modalities)
        ? model.architecture.input_modalities.map((item) => String(item).toLowerCase())
        : [];
      const analysis = model.benchmarks?.artificial_analysis ?? {};
      const prompt = finiteNumber(model.pricing?.prompt);
      return {
        id: model.id,
        name,
        params: extractParamCount(
          name,
          typeof model.description === 'string' ? model.description : '',
        ),
        coding: finiteNumber(analysis.coding_index),
        intelligence: finiteNumber(analysis.intelligence_index),
        context: positiveNumber(model.context_length),
        vision: modalities.includes('image'),
        video: modalities.includes('video'),
        modalities,
        promptPrice: prompt != null && prompt >= 0 ? prompt : null,
      };
    });
}

export function formatParams(count) {
  const scaled =
    count >= 1e12 ? [count / 1e12, 'T'] : count >= 1e9 ? [count / 1e9, 'B'] : [count / 1e6, 'M'];
  const rounded = Math.round(scaled[0] * 100) / 100;
  const text = String(rounded);
  return `${text}${scaled[1]}`;
}

export function formatIndex(value) {
  return value.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

export function formatContext(tokens) {
  return `${tokens.toLocaleString('en-US')} tokens`;
}

export function formatPromptPrice(perToken) {
  if (perToken === 0) return 'free';
  const perMillion = perToken * 1e6;
  const digits = perMillion >= 1 ? 2 : perMillion >= 0.1 ? 3 : 4;
  return `$${perMillion.toFixed(digits)} / 1M tokens`;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
