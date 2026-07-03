# Prompt templates — extended examples

Use after reading project context. Replace bracketed values.

## SaaS / B2B

**Hero background**
```
Editorial illustration for a B2B SaaS website.
Scene: product dashboard on a laptop in a focused workspace, abstract data flows in the background.
Palette: background #f8fafc, ink #0f172a, primary #2563eb, accent #7c3aed.
No text, no logos. Landscape 16:9, negative space on the left 35% for headline.
```

**Workflow diagram**
```
Flat diagram: signup → onboarding → dashboard → export.
Icons connected by arrows, tiny labels only. Palette matches #f8fafc / #0f172a / #2563eb.
16:9, no paragraph text.
```

## E-commerce

**Hero foreground**
```
Lifestyle product photography: {product} in use, natural light, shallow DOF.
Neutral background #faf9f7, accent props in brand color {hex_accent}.
No text, no price tags in image. 4:5 or 16:9 per layout.
```

## Portfolio / agency

**Hero background**
```
Abstract creative texture: paper grain, ink strokes, geometric grids.
Palette: {hex_bg}, {hex_ink}, one accent {hex_primary}. No text. 16:9, mood: refined, editorial.
```

## EdTech (example — adapt hex to project)

**Hero background**
```
Editorial hero for an {industry} learning platform.
Scene: learners with tablets in a bright classroom or workspace.
Palette: {hex_bg}, {hex_ink}, {hex_primary}, {hex_accent}. No text. Left third negative space, subjects right.
16:9, trustworthy mood.
```

**Workflow diagram**
```
Workflow diagram: {step-a} → {step-b} → {step-c} → {output}.
Icons connected by arrows, tiny labels only. Palette matches project tokens.
16:9, no paragraph text.
```

## Mobile app landing

**Phone mockup scene**
```
Hand holding phone showing {app category} UI — UI is abstract blocks, no readable lorem text.
Soft studio light, background {hex_bg}. No logos. 9:16 asset optional for mobile hero column.
```

## OG / social share

```
Social preview image 1200×630 for {company}: abstract brand texture + central safe zone for title overlay.
Palette: {hex_bg}, {hex_primary}. No embedded title text (added by meta tags). Bold, legible at thumbnail size.
```

## Negative prompts (append when user’s tool supports it)

```
text, watermark, logo, blurry, low resolution, oversaturated, stock photo cliché,
handshake, cartoon, cluttered composition, wrong aspect ratio
```

## SVG / Figma vectorization

Prompts for raster images the user will **convert to SVG in Figma**. Prioritize trace-friendly art over realism.

### SVG negative prompts (append)

```
photorealistic, photograph, 3d render, cinematic lighting, soft gradient, noise, grain,
texture, blur, bokeh, detailed shadows, speech bubble, typography, letters, words,
watermark, cluttered background, more than 8 colors, painterly brush strokes
```

### Support / assistant scene (reference style)

Like a chatbot-help illustration: isometric, character + user + device, plain bg.

```
Isometric flat vector illustration, customer support / digital assistant theme.
Scene: friendly rounded robot or helper character emerging from a large simplified
smartphone frame, user sitting with tablet looking up, small question-mark icons
floating as simple shapes, gear icons as flat outlines on the floor.
Style: modern SaaS feature art, crisp vector edges, solid color blocks, no gradients.
Palette: background #eceef2, primary blue #3b82f6, accent orange #f97316, dark navy
#1e293b, white — 6 colors max.
Composition: scene grouped left-center, empty right third for website text.
No text, no speech bubbles, no UI labels — text added later in Figma.
1024×1024, SVG-trace friendly, clean outlines.
```

### Empty state / 404

```
Flat vector illustration, empty state for {product}: {scene — empty inbox, no results}.
Minimal isometric props, 2–3 colors plus background. No text. 800×600, plain #f4f1eb background.
```

### Feature icon cluster

```
Set of 4 matching flat vector icons for {features}, consistent 2px stroke, rounded corners,
isometric or front-facing, single accent color {hex_primary} on white, no labels.
Square 512×512 each, icon-sheet layout in one image with spacing for easy Figma slice.
```

### Workflow (SVG variant)

```
Horizontal isometric vector diagram: {step1} → {step2} → {step3}.
Flat boxes and arrows, solid fills, {hex_bg} background, {hex_primary} and {hex_accent} accents.
Tiny labels OK only if user explicitly wants labels in the raster (prefer no text).
1600×900, clean edges for tracing.
```

### Figma export checklist (give with every SVG prompt)

| Step | Action |
|------|--------|
| 1 | Generate PNG, import to Figma |
| 2 | Vectorize / simplify paths |
| 3 | Map fills to design tokens |
| 4 | Add text & accessibility labels in Figma |
| 5 | Export SVG, optimize (SVGO optional), place in `public/` or `src/assets/` |

## Project SVG registry

Per-site prompts with metadata live in the **project repo** (e.g. `prompts/svg/` or next to assets).

- Copy [svg-prompts/_template.md](svg-prompts/_template.md) for new sections
- Keep paste-ready prompt in sync with what you deliver in chat
- Reference examples: `example-support-illustration.md`, `example-contact-illustration.md`
