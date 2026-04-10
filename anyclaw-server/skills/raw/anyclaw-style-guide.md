---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-style-guide

You are building the frontend UI for an AnyClaw personal web app. This guide
defines exact conventions for all React components, CSS, and any text the
user will read. Consistency matters — the user sees every feature you build
side by side, so they must look like they belong together.

The user is non-technical and cannot see the code. The UI is the entire
product surface. Every label, every error, every empty state has to stand
on its own without the user ever asking "what does this mean?"

Before you write anything, read `dev/_examples/welcome.tsx`. It is the
canonical example of every pattern in this guide. When in doubt, copy
its shape.

## Voice & tone (for any text the user will read)

Every string you put in the UI — labels, buttons, headings, error
messages, empty-state copy, version descriptions — follows these rules:

- **Direct.** State the thing. "Saved." not "Successfully saved your
  entry." "No entries yet." not "It looks like there's nothing here yet!"
- **Plain language.** No jargon. Not "endpoint," "collection," "schema,"
  "request," "deserialize." Talk about what the user sees.
- **Concise.** Short sentences. Cut every word that does not earn its
  place.
- **No humor, no whimsy.** No exclamation points except for "Saved!"-tier
  brevity. No mascots, no jokes, no apologies.
- **Errors are explicit and actionable.** Never "Something went wrong."
  Always: what happened, in plain words, plus the next step the user can
  take. Example: "Couldn't reach the server. Check your connection and
  try again." not "Network error."
- **Loading states are informative.** Never just a spinner with no text.
  Say what is happening: "Loading your entries..." or "Saving...".
- **Empty states are self-explanatory.** Every list, every feature, every
  page must have an empty state that tells the user what this thing is
  and what they can do to fill it. The empty state IS the onboarding.

## Reading user preferences

The user picks theme, font size, font family, language, and accent color
during onboarding. These live in PocketBase under `user_preferences`. You
read them with the `usePreferences()` hook from `hooks/usePreferences.ts`:

```tsx
import { usePreferences } from "@/hooks/usePreferences";

function MyPage() {
  const prefs = usePreferences();   // { theme, fontSize, fontFamily, accent, language }
  // ...
}
```

The `@theme` tokens already adapt to the preferences automatically — you
do not hardcode colors or font sizes. You only need to read `prefs`
directly when:
- Choosing a chart accent color (`prefs.accent`)
- Localizing a date or number (`prefs.language`)
- Conditionally rendering a translated string

You NEVER ask the user about visual preferences. If a question about
appearance comes up, the answer is in `user_preferences`.

## CSS: Tailwind v4, CSS-first config

Tailwind v4 configures its theme in `packages/frontend/src/app.css` via
`@theme`. There is no `tailwind.config.ts` file.

Do NOT use:
- Inline style objects (`style={{ }}`)
- CSS Modules
- Styled-components or any CSS-in-JS library
- Separate `.css` files other than `app.css`
- `tailwind.config.ts` (Tailwind v4 doesn't use one)

You may NOT add new `@theme` tokens without user approval via
`anyclaw_ask_user`. Use the existing tokens only.

## The @theme block (already in app.css)

```css
@import "tailwindcss";

@theme {
  /* Colors — light mode defaults */
  --color-background:  oklch(0.99 0 0);
  --color-surface:     oklch(0.97 0 0);
  --color-foreground:  oklch(0.18 0.01 260);
  --color-muted:       oklch(0.55 0.01 260);
  --color-border:      oklch(0.90 0.01 260);

  --color-primary:     oklch(0.62 0.17 255);
  --color-primary-fg:  oklch(0.99 0 0);
  --color-secondary:   oklch(0.72 0.10 200);
  --color-secondary-fg:oklch(0.15 0.01 260);
  --color-accent:      oklch(0.78 0.16 80);
  --color-accent-fg:   oklch(0.15 0.01 260);

  --color-success:     oklch(0.68 0.15 150);
  --color-warning:     oklch(0.80 0.15 80);
  --color-danger:      oklch(0.60 0.22 25);
  --color-danger-fg:   oklch(0.99 0 0);

  /* Spacing scale (rem) */
  --spacing-0:   0;
  --spacing-1:   0.25rem;
  --spacing-2:   0.5rem;
  --spacing-3:   0.75rem;
  --spacing-4:   1rem;
  --spacing-5:   1.25rem;
  --spacing-6:   1.5rem;
  --spacing-8:   2rem;
  --spacing-10:  2.5rem;
  --spacing-12:  3rem;
  --spacing-16:  4rem;

  /* Typography */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --text-xs:   0.75rem;   /* 12px */
  --text-sm:   0.875rem;  /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg:   1.125rem;  /* 18px */
  --text-xl:   1.25rem;   /* 20px */
  --text-2xl:  1.5rem;    /* 24px */
  --text-3xl:  1.875rem;  /* 30px */

  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.25rem;

  /* Shadows */
  --shadow-sm:  0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md:  0 2px 8px -2px rgb(0 0 0 / 0.08);
  --shadow-lg:  0 8px 24px -8px rgb(0 0 0 / 0.12);
  --shadow-xl:  0 20px 50px -20px rgb(0 0 0 / 0.18);
}

/* Dark mode (decision #51): automatic via prefers-color-scheme */
@media (prefers-color-scheme: dark) {
  @theme {
    --color-background: oklch(0.15 0.01 260);
    --color-surface:    oklch(0.20 0.01 260);
    --color-foreground: oklch(0.96 0 0);
    --color-muted:      oklch(0.68 0.01 260);
    --color-border:     oklch(0.28 0.01 260);

    --color-primary:    oklch(0.72 0.17 255);
    --color-primary-fg: oklch(0.12 0.01 260);
    --color-secondary:  oklch(0.72 0.10 200);
    --color-accent:     oklch(0.82 0.16 80);

    --color-success:    oklch(0.72 0.15 150);
    --color-warning:    oklch(0.82 0.15 80);
    --color-danger:     oklch(0.68 0.22 25);
  }
}
```

## Using the tokens

NEVER use raw color classes like `bg-blue-500`. Always use semantic names:

```
bg-background / text-foreground    — page
bg-surface                         — cards, panels
text-muted                         — secondary text
border-border                      — all borders
bg-primary / text-primary-fg       — primary buttons
bg-accent                          — highlights
bg-danger / text-danger-fg         — destructive
bg-success / bg-warning            — status pills
```

## Typography conventions

- Page title:    `text-2xl font-semibold text-foreground`
- Section head:  `text-lg font-medium text-foreground`
- Body:          `text-base text-foreground`
- Caption:       `text-sm text-muted`
- Small label:   `text-xs text-muted`

Use `font-semibold` for headings and `font-medium` for sub-headings. Avoid
`font-bold` except for emphasis within body text.

## Spacing conventions

- Page padding:        `p-4` mobile, `sm:p-6` larger
- Between sections:    `space-y-6`
- Between list items:  `space-y-3`
- Inside a card:       `space-y-2`
- Inline gaps:         `gap-2` or `gap-3`

## Component patterns

### Card
```tsx
<div className="bg-surface border border-border rounded-xl p-4 space-y-2 shadow-sm">
  {children}
</div>
```
Always `rounded-xl` for cards.

### Button — primary
```tsx
<button className="bg-primary text-primary-fg rounded-lg px-4 py-2 text-sm font-medium
  min-h-[44px] hover:opacity-90 active:opacity-80 transition-opacity
  focus:outline-none focus:ring-2 focus:ring-primary/50">
  {label}
</button>
```

### Button — secondary
```tsx
<button className="bg-surface border border-border rounded-lg px-4 py-2 text-sm
  font-medium text-foreground min-h-[44px] hover:bg-background active:opacity-80
  transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50">
  {label}
</button>
```

### Button — danger
```tsx
<button className="bg-danger text-danger-fg rounded-lg px-4 py-2 text-sm font-medium
  min-h-[44px] hover:opacity-90 active:opacity-80 transition-opacity">
  {label}
</button>
```

### Input
```tsx
<input
  className="w-full bg-background border border-border rounded-lg px-3 py-2
    text-base text-foreground placeholder:text-muted min-h-[44px]
    focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
    transition-colors"
  placeholder="Enter value..."
/>
```

### Empty state (REQUIRED on every list and every feature)
The empty state introduces the feature. It tells the user what this is
and what they can do next. It is not optional. Every list, every page,
every feature has one.

```tsx
<div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-3">
  <h2 className="text-lg font-medium text-foreground">No mood entries yet</h2>
  <p className="text-sm text-muted max-w-xs">
    Track how you're feeling each day to see patterns over time.
  </p>
  <button className="bg-primary text-primary-fg rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]">
    Add your first entry
  </button>
</div>
```

### Loading state (REQUIRED on every async screen)
Always include text describing what is loading. A naked spinner is not
acceptable — the user needs to know what is happening.

```tsx
<div className="flex flex-col items-center justify-center py-12 space-y-3">
  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  <p className="text-sm text-muted">Loading your entries...</p>
</div>
```

### Error state (REQUIRED — never show "Something went wrong")
Errors are explicit. Say what failed, in plain language, and tell the
user what they can do next. Never hide the failure with a silent
fallback.

```tsx
<div className="flex flex-col items-center justify-center py-12 px-6 text-center space-y-3">
  <h2 className="text-lg font-medium text-foreground">Couldn't load your entries</h2>
  <p className="text-sm text-muted max-w-xs">
    The server didn't respond. Check your connection and try again.
  </p>
  <button
    onClick={retry}
    className="bg-surface border border-border rounded-lg px-4 py-2 text-sm font-medium min-h-[44px]"
  >
    Try again
  </button>
</div>
```

## Responsive breakpoints (mobile-first)

- Default (no prefix): 320-480px, PRIMARY target (phones in the WebView)
- `sm:` 640px+  — large phone / small tablet
- `md:` 768px+  — tablet
- `lg:` 1024px+ — desktop (rare, browser access only)

Rules:
- Everything must work at 320px. No horizontal scrolling, ever.
- Single-column by default. `md:grid-cols-2`+ only at tablet and up.
- Touch targets >= 44px tall.
- Never use `text-xs` for interactive labels.

## File organization

```
packages/frontend/src/
  app.css                # Tailwind @theme — the only CSS file
  main.tsx
  App.tsx
  lib/
    pocketbase.ts        # PocketBase JS SDK client
    api.ts               # fetch wrapper for the logic service
  contexts/              # React Context providers
  hooks/                 # Reusable hooks (e.g. useCollection)
  components/            # Shared components (2+ pages use them)
    Layout.tsx
    Card.tsx
    Button.tsx
    EmptyState.tsx
    LoadingSpinner.tsx
  pages/
    Home.tsx
    mood/
      MoodPage.tsx
      MoodEntryForm.tsx
      MoodChart.tsx
```

Rules:
- One component per file. PascalCase filename matches component name.
- Pages default-export; shared components named-export.
- No barrel `index.tsx` files.
- Components over 200 lines must be split.

## State management (decision locked)

- `useState` / `useReducer` for local state.
- **PocketBase real-time subscriptions** for live data — never polling:
  ```tsx
  useEffect(() => {
    const unsub = pb.collection("mood_entries").subscribe("*", (e) => {
      setEntries(curr => mergeChange(curr, e));
    });
    return () => { unsub.then(fn => fn()); };
  }, []);
  ```
- Cross-page shared state: **React Context** in `contexts/`.
- Do NOT install Redux, Zustand, Jotai, Recoil, or similar. No exceptions
  without explicit user approval.

## Data fetching

- PocketBase SDK for CRUD. Custom hooks in `hooks/` for reusable patterns.
- Always handle loading, error, and empty states. Never render blank.

## Icons

Use `lucide-react`. Already installed. Do not install other icon libraries.

```tsx
import { Plus, Trash2, Settings, ChevronRight } from "lucide-react";
<Plus className="h-5 w-5" />
```

## Accessibility

- `alt` on all images.
- `<label>` or `aria-label` on all inputs.
- Semantic HTML: `<main>`, `<nav>`, `<section>`, `<article>`, `<button>`.
- Color alone never conveys state.
- Focus rings everywhere interactive: `focus:ring-2 focus:ring-primary/50`.

## Do NOT

- No `any` type. Type everything.
- No `@ts-ignore` / `@ts-expect-error`.
- No `!important`.
- No hardcoded colors.
- No components over 200 lines.
- No `dangerouslySetInnerHTML` unless rendering sanitized markdown.
- No elaborate animations. `transition-opacity` / `transition-colors` only.
