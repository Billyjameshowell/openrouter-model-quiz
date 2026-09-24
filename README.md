# OpenRouter Model Quiz

A single-page quiz about models on OpenRouter. Each game is 10 questions generated from the live public catalog. No API key, account, or backend. Scores stay in this browser.

## Play locally

```bash
npm i
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173.

## Production build

```bash
npm run build
```

Vite writes a static site to `dist/`. Cloudflare Pages, or any static host, can serve that folder as the site root.

Suggested Cloudflare Pages settings:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/`

No environment variables or secrets are required. The app calls `GET https://openrouter.ai/api/v1/models?sort=coding-high-to-low` from the browser. Benchmark figures are taken only from `benchmarks.artificial_analysis` when that object is present.
