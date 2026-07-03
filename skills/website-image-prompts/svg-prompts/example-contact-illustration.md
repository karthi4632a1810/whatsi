---
id: contact-illustration
title: Contact — sidebar illustration
status: example
site_placement: ContactSection.tsx — sidebar above contact cards (desktop)
asset_path: src/assets/illustrations/contact.svg
component: ContactIllustration.tsx
layout: sidebar — scene in upper two-thirds; lower third empty for contact cards
palette:
  background: "{hex_bg}"
  ink: "{hex_ink}"
  primary: "{hex_primary}"
  accent: "{hex_accent}"
  white: "#ffffff"
animation: none
figma_notes: Static SVG; delete background rect; crop viewBox to content
---

# Contact — sidebar illustration

## Use on site

Contact section sidebar: illustration above phone / email / address cards on desktop. Hidden on mobile if layout stacks.

## Layout note

Vertical sidebar layout: keep the **lower ~30%** of the art calm — contact cards stack directly underneath. Static inline SVG preferred.

## Paste-ready prompt

```
Isometric flat vector illustration for a {industry} website contact page.
Scene: two people at a small desk — one holds a tablet with simplified document pages,
the other points to a geometric monitor; stacked pages and a simplified envelope on the desk;
small floating outline icons: phone, mail, location pin — flat shapes, not readable UI.
Style: modern SaaS feature art, crisp vector edges, solid color blocks only — no gradients,
no grain, no photorealism.
Palette: solid background {hex_bg}, primary {hex_primary}, accent {hex_accent}, ink {hex_ink},
white highlights — 6 colors max.
Composition: characters and desk in upper two-thirds; lower third empty for contact cards below.
No text, no speech bubbles, no watermarks, no logos, no readable form fields.
1024×1024, optimized for vector tracing in Figma.
```

## After export

- [ ] PNG generated at 1024×1024
- [ ] Traced in Figma; background removed; viewBox cropped
- [ ] SVG saved to project asset folder
- [ ] Lower third verified calm above contact cards
- [ ] Prompt archived in project done-prompts file
