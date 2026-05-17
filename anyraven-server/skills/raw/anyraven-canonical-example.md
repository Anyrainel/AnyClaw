---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyraven-canonical-example

There is one file in this codebase that is the authoritative example of
how AnyRaven frontend code should look: `dev/_examples/welcome.tsx`.

You MUST read it before you write any new frontend code. Every task,
every time. It is short. It demonstrates every pattern you need:

- **File structure** — how a page is laid out, where types live, where
  helpers live, where the default export goes.
- **Theme tokens** — exclusively semantic Tailwind classes
  (`bg-surface`, `text-foreground`, `bg-primary`). Never raw colors.
- **Reading user preferences** — calling `usePreferences()` and using
  the result.
- **Data fetching pattern** — PocketBase SDK, real-time subscription,
  cleanup on unmount, typed records.
- **Loading state** — text plus spinner, never just a spinner.
- **Error state** — explicit message, suggested next step, retry
  button. Never silent fallback.
- **Empty state** — self-explanatory copy that introduces the feature
  and tells the user what to do next.
- **Voice** — direct, plain, no humor, no exclamation marks (except
  for one-word confirmations).

How to use this skill:

1. Open `dev/_examples/welcome.tsx` with your read tool.
2. Identify the pattern in it that matches the kind of thing you are
   about to build (list page, detail page, form, chart).
3. Copy that shape. Rename, retype, swap the data source, but keep
   the structure.
4. If you are about to deviate from the example's pattern, stop and
   ask yourself why. Deviation is allowed only when the example
   genuinely does not cover your case.

The welcome page is preserved on disk even after the user replaces the
home screen with their first real feature. It is read-only reference
material for you. Do not modify it.

If `dev/_examples/welcome.tsx` is missing, that is a bug in the install
— stop and report it via `anyraven_ask_user`.
