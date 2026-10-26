# Waitlist Landing (Draft)

- Status: **draft, not deployed** (2026-10-23). Built for validation experiment E2 (stage 2, demand signal) of the positioning plan.
- Code: `apps/web/landing.html`, `apps/web/src/landing/`, copy in `apps/web/src/i18n/ko.ts` (`landing.*`).
- Owner actions: [O-14 – O-17](owner-actions.md#2a-waitlist-landing-experiment-e2).

## What it is

A public page with three messages and an invitation waitlist form. Each message leads with a different value:

| Variant | Leads with | Hypothesis tested |
|---|---|---|
| `a` | One library for your own recordings, files and records | H1, H2 (scattered music is a problem; a mixed library is worth it) |
| `b` | Digging through credits | H3 (credit digging satisfies more than recommendations) |
| `c` | Knowing who made the music; reasons for each suggestion | H8 (trust is a reason to sign up) |

Only the hero and the three points differ, so a difference in sign-ups can be put down to the message. The copy promises only what the alpha has: it does not mention a streaming catalog, purchases, AI labelling (Q08 open) or "unlimited" anything (ACC-005, CNF-15), and it says that the catalog and purchases are not offered yet.

## How a visitor gets a variant

`?v=a|b|c` picks one (previews, per-message links). Otherwise the variant this browser saw before is reused, else one is drawn at random. The choice lives only in `localStorage` (`rabit.landing.variant`); there is no cookie and nothing that identifies the visitor. The variant is on `<main data-variant>` for later measurement.

## What it deliberately does not do yet

- **Store anything.** `submitWaitlist` returns `not-connected`; the form checks its answers and says that nothing was sent. Keeping e-mail addresses needs O-15 (storage, retention, privacy notice) first; the storage is then a new API with tests and OpenAPI documentation, plus a migration if it goes into the database.
- **Count visits or sign-ups.** Measurement (page views, clicks, sign-ups per variant and UTM) is designed in the experiment plan but not built; it needs the same decision and must not use third-party ad trackers.
- **Ship.** `landing.html` is not a build input, so `vite build` and the web deploy leave it out. It is served only by the dev server: `pnpm --filter @rabit/web exec vite`, then open `/landing.html?v=a`. Shipping it means adding it to the build input, which needs O-14 and O-15.

## Form

Email, the segment question (mirrors screener question 4), current music services (VIBE included, for H12), an over-19 confirmation (minors refused while Q01 is open) and consent to collection and use. All five are required; errors are listed in form order and tied to their field (`aria-describedby`).

## Tests

`apps/web/scripts/landing.test.mjs` (`node --test`, part of `pnpm --filter @rabit/web test`): variant selection, validation, and that the draft sends nothing. The page itself was checked by hand on the dev server (desktop and phone width, light and dark, no console errors). It has no E2E test because the E2E stack serves the production build, which does not include it.
