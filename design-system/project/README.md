# Hearth Design System

> A modern dark-mode design system for **Hearth**, a home bills payment tracking product.

## Context

Hearth helps households see, schedule, and settle their recurring bills in one calm, focused interface. The product is built to reduce the low-grade anxiety of managing money at home — so the design system optimizes for **clarity, calm, and confidence**, not visual noise.

This system is **dark-first**. Light mode is a future concern; every token, component, and screen here assumes a dark canvas.

## Sources

This design system was created from scratch in this session — **no existing codebase, Figma file, or brand assets were provided**. The design direction (color, type, voice, components) is original work for this project. If you have existing brand materials (logo, brand colors, font licenses, screenshots of the current product), please share them so we can align this system to your real product.

## Index

Root files:
- `README.md` — this file
- `colors_and_type.css` — design tokens (color, type, spacing, radius, shadow)
- `SKILL.md` — agent skill manifest, for use in Claude Code or as a portable skill
- `fonts/` — webfonts (Inter Tight for UI, JetBrains Mono for numerics)
- `assets/` — logos, marks, illustrations
- `preview/` — design-system tab preview cards
- `ui_kits/web/` — web app UI kit (dashboard, bills list, bill detail, add bill)

## Content fundamentals

**Voice.** Calm, plain, second-person. We talk *to* the user, not *about* them. We avoid fintech bravado ("Crush your bills!"), exclamation marks, and emoji. We write the way a thoughtful friend who happens to be good with money would write — short sentences, no jargon, no scolding.

**Casing.** Sentence case everywhere. Titles, buttons, menu items: "Add a bill", not "Add A Bill" or "ADD BILL".

**Numbers and money.** Currency is always shown with a thin space between symbol and amount, two decimals for totals (`$ 1,284.00`), zero decimals for in-text amounts when exact cents don't matter ("about $40 a month"). Use JetBrains Mono for any tabular currency so columns align.

**Pronouns.** "You" and "your". Never "user". Never "we" unless Hearth is taking an action ("We'll remind you 3 days before it's due").

**Tone examples.**
- ✅ "Due in 3 days. You've got this."
- ✅ "We couldn't reach your bank. Try again, or [skip for now]."
- ✅ "$ 1,284.00 across 7 bills this month."
- ❌ "Oops! Something went wrong 😬"
- ❌ "Crush your monthly bills with Hearth!"
- ❌ "User has 7 outstanding obligations."

**Empty states.** State the situation, then offer one obvious action. "No bills yet. [Add your first bill]" — not "Looks like it's pretty quiet around here!"

**Errors.** Tell the user what happened, then what to do. Never blame the user. Never use "invalid" without saying what's invalid.

**Emoji.** No. Use icons (Lucide) instead.

## Visual foundations

**Surface.** A near-black charcoal (`#0B0C0E`) is the base. Surfaces step up in luminance, never down — `surface-1` (cards), `surface-2` (popovers/menus), `surface-3` (modals). No surface ever has a colored tint or gradient. Elevation comes from luminance steps and a single soft shadow, not from saturated borders.

**Brand color.** A warm ember orange (`#F0833A`) is the only saturated color in the UI by default. It marks the active item, the primary action, the focus ring. Used sparingly — if the eye lands on ember, it means "this matters". Secondary signals (success, warning, danger) use desaturated greens, ambers, and reds.

**Typography.** Two families:
- **Inter Tight** for everything — UI, body, headings. Tight tracking on display sizes, normal tracking on body. Weights 400/500/600/700.
- **JetBrains Mono** for numerics, amounts, due dates in tables, and any code-like surface.

Display headings are heavy (700), body is regular (400), UI labels are medium (500). We don't use italic. We don't use ALL CAPS except for tiny eyebrow labels (11px, +0.08em tracking).

**Spacing.** A 4px base scale: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72, 96. Layouts breathe — cards have 24–32px internal padding, sections separate by 56–72px. Tight density is reserved for tables.

**Backgrounds.** Solid color only. No gradients, no images, no patterns, no noise textures. The only "texture" anywhere in the product is a single, very subtle radial highlight behind the active hero number on the dashboard — barely perceptible, not decorative.

**Borders.** Hairline, 1px, low-contrast (`border-subtle` is white at 6% opacity). Cards are bordered, not shadowed-only. Border radius is consistent: 6px for inputs and small chips, 12px for cards and buttons, 20px for large containers, full for circular (avatars, status dots).

**Shadows.** One shadow token, used only for elevated overlays (popovers, modals, toasts):
`0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.5)`. Cards do **not** have shadows — they have borders.

**Animation.** Functional, not decorative. Default easing: `cubic-bezier(0.2, 0, 0, 1)` (a calm ease-out). Default duration: 180ms for micro (hover, press), 240ms for state changes (panel open, sort), 320ms for entrance (modal). No bounces. No spring overshoot. Reduced-motion respected — under `prefers-reduced-motion`, durations collapse to 0ms.

**Hover.** Interactive surfaces lift by **+4% luminance** on hover (not by changing tint). Text links lift opacity from 0.85 → 1.0. Primary buttons brighten by 6%, never get bigger.

**Press.** Surfaces drop by **−2% luminance** and apply `transform: scale(0.99)` for 80ms. Buttons do not "depress" with shadow — the scale + brightness shift is enough.

**Focus.** A 2px ember ring with a 2px transparent offset (so it sits *outside* the element). Never an outline color. Always `:focus-visible`, never `:focus`.

**Transparency / blur.** Blur is reserved for the top app-bar when content scrolls under it (`backdrop-filter: blur(12px)` on `surface-0` at 80% opacity) and for the modal scrim. We don't use blur decoratively.

**Imagery.** There is essentially no photography in this product. The few illustrative moments (empty states, onboarding) are line illustrations in `fg-2` weight on transparent backgrounds — geometric, restrained, never cute. No mascots. No 3D renders.

**Cards.** `surface-1` background, 1px `border-subtle` border, 12px radius, 24px internal padding. No shadow. The card title is `fg-1` 14px medium; the card body is whatever the card holds. **Never** a colored left border, never a colored top accent strip, never a tinted background.

**Layout.** Fixed top bar (56px), optional fixed left rail (240px) on dashboards, content centered in a 1120px max-width column. The right rail is reserved for inspector/detail panels and slides in over the content (does not push).

**Iconography.** [Lucide](https://lucide.dev) at 1.5px stroke, 20px default size, `fg-2` color. Icons are decorative companions, not the primary signal — text always carries the meaning. See **Iconography** section below.

## Iconography

We use **[Lucide](https://lucide.dev)** via CDN. This is a **substitution** — the project had no existing icon set, so we picked the cleanest open-source line set with broad coverage. If your real product uses a different system (Phosphor, Heroicons, custom), tell us and we'll swap.

Loaded via:
```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
```

**Defaults.** Stroke width 1.5px, size 20px, color `var(--fg-2)`. In navigation, active items get `var(--fg-1)`. Inside primary buttons, icons inherit `currentColor` (which becomes the button text color).

**Sizes.** 16px (inline with text), 20px (default UI), 24px (section headers, mobile tap targets), 32px (empty-state hero).

**Don't.** Don't use emoji as icons. Don't mix filled and outline icons in the same surface. Don't recolor icons except for active/disabled/destructive states.

**Common icons in this product.** `home`, `receipt`, `calendar`, `bell`, `wallet`, `arrow-up-right`, `check`, `clock`, `alert-triangle`, `plus`, `search`, `settings`, `chevron-right`, `more-horizontal`.

## Caveats and substitutions

- **Fonts:** No font files were licensed for this project. We're loading **Inter Tight** and **JetBrains Mono** from Google Fonts. If you have a brand font, drop the files in `fonts/` and update `colors_and_type.css`.
- **Icons:** Lucide via CDN, as a substitution.
- **Logo:** The wordmark and mark in `assets/` are original, drawn for this system. Replace with your real logo when ready.
- **Photography / illustration:** None included. The system is intentionally text-and-token-driven.
