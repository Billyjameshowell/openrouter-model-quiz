import test from 'node:test';
import assert from 'node:assert/strict';
import { freshRun, applyAnswer } from '../src/run.js';
import { cleanName, loadLeaderboard, saveScore } from '../src/leaderboard.js';
import { pageShareUrl, streakShareText } from '../src/share.js';

test('three misses end a run while preserving its longest streak', () => {
  let run = freshRun();
  for (const correct of [true, true, false, true, false, false]) run = applyAnswer(run, correct);
  assert.deepEqual(run, {
    lives: 0, streak: 0, bestStreak: 2, totalCorrect: 3,
    history: ['correct', 'correct', 'wrong', 'correct', 'wrong', 'wrong'], over: true,
  });
});

test('leaderboard ranks by streak, total correct, then duration and survives corrupt reads', () => {
  let stored = 'broken JSON';
  globalThis.localStorage = { getItem: () => stored, setItem: (_, value) => { stored = value; } };
  try {
    assert.deepEqual(loadLeaderboard(), []);
    saveScore({ name: 'Short', score: 2, totalCorrect: 9, durationMs: 100 });
    saveScore({ name: 'Slow', score: 3, totalCorrect: 4, durationMs: 200 });
    saveScore({ name: 'Fast', score: 3, totalCorrect: 4, durationMs: 100 });
    saveScore({ name: 'More', score: 3, totalCorrect: 5, durationMs: 300 });
    assert.deepEqual(loadLeaderboard().map(entry => entry.name), ['More', 'Fast', 'Slow', 'Short']);
    assert.equal(cleanName('  Player\n   One  '), 'Player One');
    localStorage.setItem = () => { throw new Error('Storage blocked'); };
    assert.throws(() => saveScore({ name: 'Retry', score: 1, durationMs: 100 }), /Storage blocked/);
  } finally { delete globalThis.localStorage; }
});

test('share keeps the deployed subpath and removes query/hash', () => {
  const url = pageShareUrl('https://example.com/openrouter-model-quiz/index.html?source=test#score');
  assert.equal(url, 'https://example.com/openrouter-model-quiz/');
  assert.equal(streakShareText(12, url), `I got 12 in a row on the OpenRouter Model Quiz — can you beat me?\n${url}`);
});
