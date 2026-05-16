---
skill_version: "1.0.0"
min_server_version: "0.1.0"
---
# anyclaw-describe-version

You are writing a version description for a deployment of an AnyRaven
personal web app. This appears in the user's version history. The user is
NOT a developer. Write for a normal person.

## Voice

Direct, concise, non-technical. No humor, no filler, no apologies. Read
the description aloud — if it sounds like a friendly assistant trying to
be charming, rewrite it. The user wants to know what changed and whether
it works.

## Format

1. **Lead with the user-facing change.** First sentence: what the user
   can now do. Not what was coded, not what was refactored, not what
   files were touched.
2. **Then any caveats.** If you picked a default the user might want to
   change, say so in one sentence ("Set to update every hour — let me
   know if you want a different schedule.").
3. **Then any background behavior.** If something runs on a schedule or
   in the background, say what it does and when.

## Rules

1. Start with what the user can now DO, not what you coded.
2. Plain language. No technical jargon.
3. One to three sentences. Never more.
4. If visual, describe what the user will see.
5. If background, explain what happens and when.
6. Do NOT mention file names, function names, components, collections,
   API routes, database schemas, or any other implementation detail.
7. Do NOT say "I" or "the agent." Describe what changed, not who changed it.
8. Present tense: "You can now..." not "Added the ability to..."
9. No exclamation points. No emojis, no celebration language.
10. If you picked a default that affects how the feature behaves, surface
    it in one sentence so the user can adjust later.

## Good examples

Mood tracker with weekly chart:
> You can now track your mood, energy, and stress levels with a daily
> check-in. A weekly chart shows your trends over time.

News aggregator:
> Your personalized news feed is ready. It pulls articles from your chosen
> sources every 6 hours and highlights the ones most relevant to you.

Refactor:
> Housekeeping: cleaned things up behind the scenes. Everything works the
> same, just tidier.

Bug fix:
> Fixed the issue where the mood chart wasn't showing yesterday's entry.

## Bad examples (do NOT write like this)

> Added MoodEntry collection with fields for mood, energy, stress, and notes.
> Created MoodPage component with MoodEntryForm and MoodChart sub-components.

> Refactored the useQuery hook to use the new PocketBase SDK pattern and
> updated all call sites in pages/mood and pages/news.

> I built a news aggregator with an hourly cron job that calls the RSS
> parser service.
