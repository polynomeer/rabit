# Brand colour contrast audit (input to OQ-BRD-03)

- Status: evidence for a pending decision — the working palette (BRD §3) is not final.
- Date: 2026-10-10
- Method: WCAG 2.1 relative-luminance contrast. Re-run with `pnpm --filter @rabit/web contrast`
  (`apps/web/scripts/contrast.mjs`); it reads the tokens from `apps/web/src/styles.css`,
  and `pnpm test` (CI) fails if any pair drops below its threshold.

## 1. Brand colours used directly as text

| Colour | on Ink `#111111` | on Canvas `#F4F1EC` |
|---|---|---|
| Rabit Purple `#7865C8` | 4.04 ✗ | 4.15 ✗ |
| Sunset Orange `#EB7B4C` | 6.72 ✓ | 2.50 ✗ |
| Archive Sage `#59615B` | 2.95 ✗ | 5.67 ✓ |
| Ink / Canvas on each other | 16.76 ✓ | 16.76 ✓ |
| White on Rabit Purple (filled buttons) | 4.67 ✓ | — |

So the working brand colours cannot all be used as body text in both themes. The web
client therefore uses **derived text tokens** and keeps the brand colours for fills,
glows and accents:

| Role | Dark | Light |
|---|---|---|
| Accent text / outlines (`--accent`) | `#A898EE` (≥ 6.30) | `#5A48AA` (≥ 5.79) |
| Warning / orange text (`--warn`) | `#F0A57C` (≥ 7.79) | `#9A3F12` (≥ 5.51) |
| Success text (`--ok`) | `#8FD19E` (≥ 8.84) | `#1F6B33` (≥ 5.31) |
| Secondary text (`--muted`) | `#A9A4AE` (≥ 6.46) | `#5B5852` (≥ 5.75) |

(Lowest ratio across the page, card and raised-card surfaces; AA needs 4.5.)

## 2. Control boundaries (WCAG 1.4.11, 3:1)

The general hairline `--line` (`#2A2830` dark, `#DCD7CF` light) is only 1.33 / 1.27 against
the page — fine for decorative dividers and cards, **not** for the edge that tells a text
field apart from the page. Text fields, selects, text areas and the search field now use
`--control-line`: `#706B77` dark (≥ 3.05) and `#857F77` light (≥ 3.22). axe-core does not test
1.4.11, which is why CI had not caught this.

## 3. Suggestions for the decision (OQ-BRD-03)

1. Keep Ink, Canvas and Rabit Purple as brand fills; adopt the derived text tokens above
   (or brand-approved equivalents) as the official text colours per theme.
2. If Sunset Orange and Archive Sage must appear as text, define a darker light-theme
   orange (≈ `#9A3F12`) and a lighter dark-theme sage (≈ `#A9B5AB`, 8.6 on Ink).
3. OLED: the dark background is `#0E0E10`, not pure black, to avoid smearing on scroll;
   confirm on devices before finalising.
