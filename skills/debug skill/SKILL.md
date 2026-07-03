---
name: debug-skill
description: >-
  Catch UI visibility, contrast, overlay, navigation state, SVG animation
  glitches, hero grid masking, and runtime crash bugs before shipping. Use when
  building headers, transparent navs, hero sections, full-bleed hero backgrounds,
  scroll-state styles, viewport nav highlighting, IntersectionObserver scroll-spy,
  multi-frame SVG illustrations, or after blank screen / console errors. For AI
  image-generation prompts on any site, use the website-image-prompts skill.
---

# Debug Skill — Visibility & Contrast

Use this skill **before finishing** any UI that involves layered backgrounds, transparent chrome, or scroll-driven class swaps.

## Bug 1 — Dark text on dark hero (page top)

**Symptom:** Header text barely visible at page top; CTA button still readable.

**Cause:** `scroll-on-top` made the header **transparent** over a **dark hero**, but nav tokens (`text-ink`, `text-mist`, `text-cobalt`) were styled for a **light** header bar.

**Fix:** Define a **dark-surface palette** (light text) when the header sits on the hero.

## Bug 2 — Light text on light header (scrolled) ← common follow-up

**Symptom:** Nav links and tagline look white/ghost-grey on a **white** header bar; only the CTA is readable.

**Cause:** `scroll-on-top` (or dark-surface styles) **stayed on `body`** after leaving the hero because scroll logic only removed it when `scrollY` delta exceeded 5px. Slow or small scroll steps never cleared the class, so **dark-surface text colors** rendered on a **light** header background.

**Fix:**
1. Derive header surface from **absolute scroll position** (`scrollY < threshold`), not scroll delta.
2. Set an explicit attribute, e.g. `data-header-surface="dark" | "light"`.
3. Style both surfaces in CSS — never rely on “absence of a class” for the light palette.

```ts
// CORRECT — position drives surface
if (y < TOP_THRESHOLD) {
  body.dataset.headerSurface = "dark";
} else {
  body.dataset.headerSurface = "light"; // always, every scroll event past threshold
}
```

```ts
// WRONG — stale dark palette on light bar
if (y > lastY + 5) {
  body.classList.remove("scroll-on-top"); // only sometimes runs
}
```

## Bug 3 — Blank screen (IntersectionObserver `rootMargin`)

**Symptom:** Page is completely blank (beige/white). DevTools console shows:

`Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.`

**Cause:** `IntersectionObserver` `rootMargin` was set with **`rem`** or **`em`** (e.g. `"-5.5rem 0px -52% 0px"`). The API accepts **only `px` and `%`** — invalid units throw synchronously and crash the component that calls the hook (often `<Navigation>` → entire app tree fails).

**Fix:**

```ts
// WRONG — throws, blank screen
rootMargin: "-5.5rem 0px -52% 0px"

// CORRECT — measure header in px, or use a px constant
const headerPx = Math.round(
  document.querySelector(".site-header")?.getBoundingClientRect().height ?? 72
);
rootMargin: `-${headerPx}px 0px -52% 0px`
```

CSS `scroll-margin-top: 5.5rem` on sections is fine — the restriction applies only to **IntersectionObserver**, not CSS.

**Verify:** Open DevTools console on load — zero red errors before marking nav scroll-spy done.

## Bug 4 — Light text on white bar (wrong scroll target)

**Symptom:** Logo tagline and nav links look pale/white on a **white** header while scrolled deep into the page (e.g. a mid-page section). Brand accent looks washed-out.

**Cause:** Page scroll lives on an inner `overflow-auto` div, but hooks read **`window.scrollY`** (always `0`). `data-header-surface` stays `"dark"` forever → transparent header + light text colors over white sections.

**Fix:**

1. Mark the scroll container: `data-scroll-root` on the `overflow-auto` element.
2. Read **`scrollRoot.scrollTop`**, not `window.scrollY`.
3. Set `IntersectionObserver` **`root: scrollRoot`** (not viewport default).
4. Derive dark surface while header overlaps hero: `scrollTop < hero.offsetHeight - headerHeight`.

```tsx
// Scroll container — scroll happens HERE, not on window
<div data-scroll-root className="size-full overflow-auto">
```

```ts
const scrollEl = document.querySelector<HTMLElement>("[data-scroll-root]");
const y = scrollEl?.scrollTop ?? window.scrollY;
body.dataset.headerSurface = isOverHero(y) ? "dark" : "light";
```

**Verify:** Scroll to a mid-page section → DevTools → `document.body.dataset.headerSurface` must be `"light"`.

## Bug 5 — Header only visible when scrolling up

**Symptom:** Nav bar disappears while scrolling down; only reappears when scrolling up. Can look like an empty dark strip fixed at the top.

**Cause:** `body.scroll-down { transform: translateY(-100%) }` hides the header on downward scroll (Developer DNA scroll-hide pattern). Wrong for sites where nav must always be reachable.

**Fix:** Remove scroll-direction hide logic. Keep header `position: fixed; top: 0; left: 0; right: 0; z-index: 50` at all times. Only toggle `data-header-surface` for color changes.

**Do not** add scroll-hide unless the user explicitly asks for it.

## Bug 6 — SVG two-frame swap (double hands + “reloads every time”)

**Symptom:** Animated illustration shows **two arms at once** for a frame, or feels like it **reloads** each time you scroll to the section; the right column can appear **empty** until scroll animation finishes.

**Cause:** Two full SVG files (`character-rest.svg`, `character-wave.svg`) stacked as `<img>` tags and swapped with **CSS opacity/visibility keyframes**. Both images load separately, the crossfade window can show both frames, and wrapping the illustration in **`motion` `whileInView` opacity** hides it until scroll triggers — which feels like a reload.

**Fix:**

1. **Merge into one SVG** — static body + animated sub-groups (e.g. `#arm-rest`, `#arm-wave`).
2. Animate **only the moving groups** with **SMIL** `<animate attributeName="opacity" … calcMode="discrete"/>` so poses are never visible together.
3. **Inline the SVG** via bundler raw import — one asset, no dual image fetch.
4. **Do not** fade the illustration on scroll — keep the visual wrapper always visible; animate copy only if needed.
5. **`prefers-reduced-motion`:** strip `<animate>` tags and show static rest pose.

```tsx
// CORRECT — single inline SVG, SMIL handles pose swap
import illustrationSvg from "./illustration.svg?raw";

// WRONG — two stacked images + CSS frame swap
<img src={frameRest} className="frame--rest" />
<img src={frameWave} className="frame--wave" />
```

```xml
<!-- SMIL inside one SVG — discrete opacity, one pose at a time -->
<g id="arm-rest">
  <animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.49;0.5;1"
    dur="2s" repeatCount="indefinite" calcMode="discrete"/>
</g>
<g id="arm-wave" opacity="0">
  <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.49;0.5;0.99;1"
    dur="2s" repeatCount="indefinite" calcMode="discrete"/>
</g>
```

**Placement:** Heavy animated SVGs belong in **split content sections**, not the home hero, unless the layout explicitly calls for it.

**Verify:**

| Test | Expected |
|------|----------|
| Load section with illustration | Visual visible immediately |
| Watch animation for 10s | Only **one** pose visible at any moment |
| Scroll away and back | No blank flash, no double-fetch flicker |
| `prefers-reduced-motion: reduce` | Static rest pose, no SMIL |

**Anti-patterns:**

- Full-image CSS frame swap for SVG pose changes (use SMIL or inline path morph on one file)
- `position: absolute` stacked `<img>` frames for character animation
- `whileInView={{ opacity: 0 }}` on the illustration wrapper
- Placing heavy animated SVGs on the hero when a split content section is the right fit

## Bug 7 — Spec grid over hero photo (mask left only)

**Symptom:** A decorative **grid or pattern overlay** is visible on top of the **hero photograph**, making the image look busy or “wireframed.” User wants the pattern on the **copy side only**, stopping in an **organic / uneven** edge — not a hard vertical cut.

**Cause:** The grid element uses `position: absolute; inset: 0` and spans the full hero. Layer stack puts the grid above the photo wherever the overlay is transparent.

**Fix:** Keep the full-bleed grid element, but **mask** it with an inline **SVG path** (data URI). White fill = grid visible; everything outside the path = hidden.

```tsx
// Hero — grid stays a sibling of overlay + background
<div className="hero__grid pattern-grid opacity-30 pointer-events-none" aria-hidden />
```

```css
/* Mask grid to copy side only — irregular right edge; tune path X values */
.hero__grid {
  position: absolute;
  inset: 0;
  z-index: -1;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cpath fill='white' d='M0 0 H60 L64 7 L57 15 L63 23 L56 31 L62 39 L55 47 L61 55 L54 63 L60 71 L53 79 L59 87 L52 95 L58 100 H0 Z'/%3E%3C/svg%3E");
  mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cpath fill='white' d='M0 0 H60 L64 7 L57 15 L63 23 L56 31 L62 39 L55 47 L61 55 L54 63 L60 71 L53 79 L59 87 L52 95 L58 100 H0 Z'/%3E%3C/svg%3E");
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
```

**Tuning the stop line:**

| Goal | Change |
|------|--------|
| Grid further **right** (more coverage) | Increase X coords in the wavy path (e.g. `H46` → `H60`) |
| Grid stops **sooner** (more clear photo) | Decrease X coords (e.g. `H60` → `H48`) |
| Straighter edge | Replace path with `linear-gradient` mask |
| More “random” wobble | Add more `L x y` points along the right edge |

**Do not** remove the grid from the copy side — only mask the photo side. Align mask edge with the hero gradient overlay so grid fades before the subject.

**Verify:**

| Test | Expected |
|------|----------|
| Hero desktop | Grid on copy area; **none** on photo |
| Edge | Uneven / organic stop, not a ruler-straight line |
| Slow resize | Mask scales with hero (`mask-size: 100% 100%`) |
| Mobile | Grid confined to text side; photo readable |

**Anti-patterns:**

- `clip-path: inset(0 40% 0 0)` — hard straight cut unless explicitly desired
- Lowering grid `opacity` on the photo side instead of masking — grid still tints the photo
- Putting grid **above** content (`z-index` positive) — must stay behind copy (`z-index: -1`)

## Rules

1. When background and text are decoupled, **define text color per surface state** — not per component in isolation.
2. Surface state must be **idempotent**: recomputed from position on every scroll event.
3. Never use pale tokens (`text-mist`, `rgba(…, 0.7)`) for nav links on white — use **≥ 4.5:1** contrast (`#2e2c28` on `#f4f1eb` or darker).

## Pre-ship checklist

### 1. Surface × state matrix

| `data-header-surface` | Header background | Nav link color | Verified? |
|---------------------|-------------------|----------------|-----------|
| `dark` | Transparent / over hero | Light (paper) | ☐ |
| `light` | Solid paper/white bar | Dark (ink) | ☐ |
| Mobile menu open | Dark overlay | Light | ☐ |

### 2. Contrast minimums (WCAG AA)

- Nav links on solid backgrounds: **≥ 4.5:1**
- Taglines / secondary chrome: **≥ 4.5:1** (do not use `text-mist` on white)
- Large headings: **≥ 3:1**

### 3. Scroll test script (mandatory)

1. **Top** (`scrollY = 0`) — logo, tagline, links, menu icon readable on dark hero
2. **Slow scroll** one wheel tick at a time past hero — links must flip to **dark** on light bar (this catches Bug 2)
3. **Fast scroll** to mid-page — same as step 2
4. **Scroll up** from mid-page — header returns with **dark** text, not ghost white
5. Mobile — repeat 1–4

### 4. CSS structure

```css
body[data-header-surface="light"] .site-header .nav-link { color: #2e2c28; }
body[data-header-surface="dark"]  .site-header .nav-link { color: rgba(244,241,235,.92); }
```

Both branches required. No single default that “usually works.”

## When user says "not visible" / "can't read"

1. Identify **what is behind** the text (hero? white bar? transparent?)
2. Inspect `body` classes and `data-*` attributes in DevTools at that scroll position
3. Check for **stale state** (dark palette + light background, or the reverse)
4. Fix state logic first, then adjust color tokens
5. Re-run the scroll test script above

## Anti-patterns

- Transparent header + one static text color in JSX
- Tying surface removal to scroll **direction/delta** instead of scroll **position**
- `text-mist` for navigation on white backgrounds
- Shipping scroll chrome without the **slow scroll** test
- Assuming fast-scroll manual QA covers all cases
- CSS-swapping two full SVG `<img>` frames for pose animation (see Bug 6)
- Full-width pattern grid on full-bleed heroes without masking the photo side (see Bug 7)

## Viewport nav highlighting (`:target` + scroll sync)

Highlight the menu item for the section currently in the viewport. Pair **IntersectionObserver** (scroll) with **URL hash** (`:target`) so click navigation and scroll stay in sync.

### Implementation pattern

1. **Observe** every `section[id]` that has a nav link.
2. **Pick active** section by highest `intersectionRatio` inside a `rootMargin` band below the fixed header (e.g. `-72px 0px -52% 0px` — **px only**, never `rem`).
3. **Sync state** on every change:
   - `document.body.dataset.activeSection = id`
   - `history.replaceState(null, '', `#${id}`)` — updates `:target` without scroll jump
4. **Style active link** with `::before` sliding **top → bottom** on hover/active:

```css
.site-header .nav-link::before {
  content: "";
  position: absolute;
  left: 0; right: 0;
  top: 0;
  height: 2px;
  transform: scaleX(0);
  transition: top 0.4s ease, transform 0.35s ease;
}
.site-header .nav-link--active::before {
  top: calc(100% - 2px);
  transform: scaleX(1);
}
/* Dark bar: orange line. Light bar: cobalt underline, orange text */
```

### Header overlay slide (scroll-linked)

Light paper bar sits under a dark `::before` overlay on `.site-header`. Scroll progress (`--header-overlay-progress`, `0` → `1`) drives `translateY` so the overlay **slides down** and reveals the light header — same motion language as nav `::before`.

```css
.site-header { background: rgba(244,241,235,.97); overflow: hidden; }
.site-header::before {
  inset: 0;
  background: rgba(18,22,28,.82);
  transform: translateY(calc(var(--header-overlay-progress, 0) * 100%));
}
```

Set progress from `scrollRoot.scrollTop / (heroHeight - headerHeight)` on every scroll event.

### Nav order must match page section order

Menu links, scroll-spy section IDs, and page render order must stay aligned. Use **one config source** (e.g. `sections.ts`) — do not duplicate nav arrays in the header component.

**Pattern:**

| Order | `id` | Nav label |
|------:|------|-----------|
| 1 | `home` | Home |
| 2 | `{section-a}` | {Label A} |
| 3 | `{section-b}` | {Label B} |
| … | … | … |

Sections without nav entries may sit between linked sections but are not in the menu.

When adding or reordering sections, update the shared config in the same commit and re-run the scroll-spy checklist.

5. **Section `:target`** — add `scroll-margin-top` equal to header height; optional subtle `outline` animation on `section:target`.
6. **Accessibility** — `aria-current="page"` on the active nav link.

### Nav highlight checklist

| Test | Expected |
|------|----------|
| Page load at top | **Home** active |
| Slow scroll through each section | Matching nav item highlights; hash updates |
| Click nav link | Section scrolls; that item stays active |
| Direct URL with `#section-id` | Matching section active on load |
| Dark + light header | Active link readable on **both** surfaces |
| Mobile menu | Active item uses brand accent color |

### Anti-patterns

- `:target` CSS on nav links only (nav is not the target element — `section` is)
- Active styles that only work on one header surface
- Setting `location.hash` on scroll (causes jump) — use `replaceState` instead
- No `scroll-margin-top` on sections (content hides under fixed header)
- `rem` / `em` in `IntersectionObserver` `rootMargin` (crashes app — see Bug 3)
- Reading `window.scrollY` when the app scrolls inside `overflow-auto` (see Bug 4)
- Nav items in a different order than page sections (see **Nav order must match page section order**)

## Website images

For image-generation prompts (hero, diagrams, section art), use the **website-image-prompts** skill. Discover brand tokens and asset folders from the current project codebase.
