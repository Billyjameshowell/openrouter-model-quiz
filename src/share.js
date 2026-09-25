export function pageShareUrl(href) {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  if (url.pathname.endsWith('/index.html')) {
    url.pathname = url.pathname.slice(0, -'index.html'.length);
  }
  return url.toString();
}

export function streakShareText(bestStreak, pageUrl) {
  return `I got ${bestStreak} in a row on the OpenRouter Model Quiz — can you beat me?\n${pageUrl}`;
}
