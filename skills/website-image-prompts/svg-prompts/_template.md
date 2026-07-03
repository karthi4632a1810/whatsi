---
id: {slug}
title: {Human title}
status: planned
site_placement: {Component.tsx — section name}
asset_path: src/assets/illustrations/{filename}.svg
component: {React component that inlines the SVG}
layout: {split left | split right | full width | sidebar}
palette:
  background: "{hex_bg}"
  ink: "{hex_ink}"
  primary: "{hex_primary}"
  accent: "{hex_accent}"
  white: "#ffffff"
animation: none
figma_notes: Vectorize PNG → simplify paths → delete background rect → crop viewBox → export SVG
---

# {Human title}

## Use on site

{One sentence: which section and column.}

## Layout note

{Negative space, aspect ratio, max-width class, reduced-motion behavior.}

## Paste-ready prompt

```
{Full prompt paragraph for image generator}
```

## After export

- [ ] PNG generated at listed size
- [ ] Traced in Figma; background removed
- [ ] SVG saved to `asset_path`
- [ ] Component wired; `alt` / `aria-label` set
- [ ] Status updated to `deployed` in README index
