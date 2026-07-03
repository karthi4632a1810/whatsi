---
id: support-illustration
title: Support section — feature illustration
status: example
site_placement: SupportSection.tsx — right column, split layout
asset_path: src/assets/illustrations/support.svg
component: SupportIllustration.tsx
layout: split right (text left, illustration right)
palette:
  background: "{hex_bg}"
  ink: "{hex_ink}"
  primary: "{hex_primary}"
  accent: "{hex_accent}"
  white: "#ffffff"
animation: SMIL optional (animate sub-groups only — see debug skill Bug 6)
figma_notes: Merge pose variants into one SVG; no dual stacked images
---

# Support section — feature illustration

## Use on site

Split content section (headline left, illustration right). **Not** on the home hero unless the layout explicitly calls for it.

## Layout note

Split grid; illustration `max-width` capped (~36rem). Inline via bundler raw import if needed. No scroll-triggered opacity fade on the visual wrapper.

## Paste-ready prompt

```
Isometric flat vector illustration for a {industry} website support or feature section.
Scene: friendly guide character beside a user with a tablet or laptop; simplified device
frame as a geometric prop; small icons as flat outline shapes.
Style: modern SaaS feature art, crisp vector edges, solid color blocks only — no gradients,
no grain, no photorealism.
Palette: solid background {hex_bg}, primary {hex_primary}, accent {hex_accent}, ink {hex_ink},
white — 6 colors max.
Composition: scene grouped left-center, large empty calm area on the right third for headline.
No text, no speech bubbles, no watermarks.
1024×1024, optimized for vector tracing in Figma.
```

## Animation (optional)

If two poses exist (rest + action), animate **only the moving part** with SMIL inside one SVG — do not stack two `<img>` frames.

## After export

- [ ] PNG generated
- [ ] SVG traced and simplified in Figma
- [ ] Component wired with meaningful `aria-label`
- [ ] Status updated in project registry
