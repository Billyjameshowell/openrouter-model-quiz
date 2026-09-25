export const STARTING_LIVES = 3;

export function freshRun() {
  return {
    lives: STARTING_LIVES,
    streak: 0,
    bestStreak: 0,
    totalCorrect: 0,
    history: [],
    over: false,
  };
}

export function applyAnswer(run, correct) {
  const history = run.history.slice();
  if (correct) {
    const streak = run.streak + 1;
    history.push('correct');
    return {
      lives: run.lives,
      streak,
      bestStreak: Math.max(run.bestStreak, streak),
      totalCorrect: run.totalCorrect + 1,
      history,
      over: false,
    };
  }
  const lives = run.lives - 1;
  history.push('wrong');
  return {
    lives,
    streak: 0,
    bestStreak: run.bestStreak,
    totalCorrect: run.totalCorrect,
    history,
    over: lives <= 0,
  };
}
