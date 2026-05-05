# @anyclaw/frontend-template

Vite + React 18 + Tailwind v4 seed project. Copied into `/data/dev/` by `init-data-layout.sh` on first server run, becoming the starting point for the agent-built frontend. The agent reads and modifies these files to fulfill user feature requests.

This package is **not imported by any other package** — it is a standalone Vite project that ships as a template.

## Contents

- `src/App.tsx` — React Router root with route definitions.
- `src/main.tsx` — Vite entry point.
- `src/pages/Welcome.tsx` — Example page demonstrating PocketBase data fetching, error states, and theme integration. Serves as a canonical code pattern for agents to follow.
- `src/_examples/welcome.tsx` — Archived original welcome page; agents use it as a reference.
- `src/lib/pocketbase.ts` — PocketBase JS SDK client instance.
- `src/hooks/usePreferences.ts` — Reads user theme/font/accent preferences from PocketBase and exposes them as React context.

## Design Conventions

All agent-generated UI should follow these conventions (from the AnyClaw design system in `docs/design.md`):

- Tailwind v4 utility classes for all styling.
- `oklch` color values for the accent color (user-chosen during onboarding).
- Warm off-white background in light mode; deep neutral in dark mode.
- 8px radius for cards/buttons, 4px for inputs, 12px for sheets.
- No hardcoded colors — always use CSS variables from the `@theme` block.

## Development

```bash
npm run dev            # Vite dev server (hot reload)
npm run build          # Production build → dist/
npm run preview        # Preview production build
```

## Dependencies

- `react` + `react-dom` 18
- `react-router-dom` — SPA routing
- `pocketbase` 0.25 — real-time backend
- `lucide-react` — icons
- `tailwindcss` v4 + `@tailwindcss/vite`
