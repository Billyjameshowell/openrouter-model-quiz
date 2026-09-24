const STORAGE_KEY = 'openrouter-model-quiz-v1';

function validEntry(entry) {
  return (
    entry &&
    typeof entry.id === 'string' &&
    typeof entry.name === 'string' &&
    entry.name.trim().length > 0 &&
    Number.isInteger(entry.score) &&
    entry.score >= 0 &&
    entry.score <= 10 &&
    typeof entry.durationMs === 'number' &&
    Number.isFinite(entry.durationMs) &&
    entry.durationMs >= 0
  );
}

export function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

export function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validEntry).slice(0, 20);
  } catch {
    return [];
  }
}

function sortBoard(entries) {
  return entries.slice().sort((a, b) => b.score - a.score || a.durationMs - b.durationMs || a.savedAt - b.savedAt);
}

export function saveScore({ name, score, durationMs }) {
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    score,
    durationMs,
    savedAt: Date.now(),
  };
  const next = sortBoard([...loadLeaderboard(), entry]).slice(0, 20);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return { board: next, entry };
}
