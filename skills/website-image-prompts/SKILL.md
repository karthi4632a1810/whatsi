---
name: website-image-prompts
description: >-
  Generates tailored AI image-generation prompts for website and app UI assets
  (hero backgrounds, diagrams, section art, OG images, SVG-ready illustrations).
  Includes vector-friendly prompts for assets the user will trace or convert to
  SVG in Figma. Discovers brand tokens and layout from the project. Use when
  the user asks for image prompts, hero visuals, SVG illustrations, isometric
  art, marketing assets, "generate an image for the site", or Figma vector
  conversion.
---

# Website Image Prompts

Use this skill on **any project** when the user needs prompts for ChatGPT, DALL·E, Midjourney, Flux, etc. — not project-specific debug rules.

## Workflow

1. **Discover context** (read before writing prompts):
   - Brand colors: `theme.css`, `tailwind.config.*`, CSS variables, design tokens, `SKILL.md`, Figma tokens
   - Site purpose: hero copy, about page, product category
   - How images are used: inspect hero/section components (`object-fit`, background-image, carousel vs bleed)
   - Asset folder: `src/assets/`, `public/`, `src/imports/`, etc.

2. **Classify each image** (see roles below). One prompt per role — do not combine hero + diagram in one image.

3. **Output prompts** using the format in [Output format](#output-format). Give 1–3 prompts unless the user asks for more.

4. **Add layout note** when wiring matters: e.g. "left third negative space for headline overlay", "full diagram — use object-contain".

5. **Offer layout fix** when the asset is fine but the UI is wrong (carousel crop, wrong `object-fit`) — prompts alone won't fix that.

## Image roles

| Role | Typical use | Composition | object-fit hint |
|------|-------------|-------------|-----------------|
| **Hero background** | Full-bleed behind headline | 16:9; calm negative space where copy sits | `cover`; decorative `alt=""` |
| **Hero foreground** | Beside or below copy | Subject clear; may match split layout | `cover` or `contain` |
| **Diagram / workflow** | Explain process | Readable labels; horizontal flow | **`contain`** — never crop labels |
| **Photo card** | Team, product, mission | Subject centered; no text in image | `cover` in small cards OK |
| **Section texture** | Dividers, backgrounds | Abstract, low detail | `cover` or CSS background |
| **OG / social** | `og:image` | Center-safe; title safe zone | 1200×630 |
| **SVG illustration** | Feature blocks, empty states, support sections | Simple shapes; plain bg; **no text** | Export SVG from Figma; use inline or `<img>` |

## SVG-ready illustrations (Figma workflow)

Use when the user will **generate a raster image → vectorize in Figma → export SVG** for the site.

### Figma handoff (tell the user)

1. Generate PNG at **1024×1024** or **1600×1200** (square or 4:3 works well for feature art)
2. Import into Figma → **Vectorize** (or trace with clean paths)
3. Simplify layers, replace colors with project tokens, **add any text in Figma** (not in the AI image)
4. Export **SVG** → `public/` or `src/assets/`
5. Prefer `currentColor` or CSS variables for fills when possible

### SVG prompt rules (always include)

| Rule | Why |
|------|-----|
| **Flat vector / isometric illustration** | Clean paths trace better than photo |
| **Solid fills, 4–6 colors max** | Fewer layers after vectorize |
| **Sharp edges, no noise/grain** | Reduces messy anchor points |
| **Plain solid background** (`#f4f1eb` or `#ffffff`) | Easy to delete or make transparent |
| **No text, speech bubbles, or UI copy** | Text is added in Figma/code — AI text is not editable |
| **No soft shadows or heavy gradients** | Use flat offset shapes for depth instead |
| **Simple decorative icons** (gears, envelopes, question marks) | OK as outline shapes |
| **Grouped composition** | Subject left/center, **empty right third** for website copy |

### SVG prompt formula (extra block)

Add to the standard formula:

```
[VECTOR STYLE] — isometric flat vector illustration, clean geometric shapes, crisp outlines
[SVG CONSTRAINTS] — solid color blocks only, no text, no speech bubbles, no photorealism,
  no texture, no blur, plain single-color background, maximum 6 colors
[FIGMA NOTE] — designed to be traced to SVG; text and labels added later in Figma
```

### SVG illustration template

```
Isometric flat vector illustration for a {industry} website feature section.
Scene: {subject — e.g. friendly assistant character helping a user with a tablet}.
Style: modern SaaS illustration, clean geometric shapes, crisp vector edges, minimal depth
using flat color planes only — no gradients, no grain, no photorealism.
Palette: background {hex_bg} solid fill, primary {hex_primary}, accent {hex_accent},
dark {hex_ink} for outlines, white highlights — maximum 6 colors total.
Composition: subjects grouped on the left and center, large empty calm area on the right
third for website headline and copy overlay.
Include simple decorative icons ({icons — gears, documents, accessibility symbols}) as
flat outline shapes, not detailed.
No text, no speech bubbles, no watermarks, no logos.
Square 1024×1024 or landscape 4:3, high contrast edges, SVG-trace friendly.
```

### Reference style (chatbot / support illustration)

Match this **structure** when user shows an isometric support-style example:

- Friendly rounded character (robot, guide, or helper) + human user seated or standing
- Large device frame (phone, tablet, or monitor) as a simple geometric prop
- Question marks or small icons floating as **simple shapes** — not readable UI
- Light neutral background, blue + orange accent palette (swap for project hex)
- **Do not** include "Hi! How can I help you?" or any copy — user adds text in Figma

**Example (SaaS support section — replace placeholders from project tokens):**

```
Isometric flat vector illustration for a {industry} website feature section.
Scene: friendly guide character beside a user with a tablet; simplified device frame
as a geometric prop; small gear and document icons as flat outline shapes.
Style: clean isometric vector art, solid color fills, crisp edges, no gradients or texture.
Palette: background {hex_bg}, primary {hex_primary}, accent {hex_accent}, ink {hex_ink},
white accents — 6 colors max.
Composition: characters and props on left two-thirds, empty calm right third for headline.
No text, no speech bubbles, no watermarks.
1024×1024, optimized for vector tracing in Figma.
```

More SVG examples: [prompt-templates.md](prompt-templates.md#svg--figma-vectorization)

## SVG prompt registry (per project)

For illustrations that ship as inline SVG, keep one markdown file per slot in the **project repo** — metadata + paste-ready prompt.

### Suggested project layout

```
src/assets/illustrations/       ← exported SVG files
prompts/svg/                    ← one .md per slot (name: {section-slug}.md)
prompts/done-prompts.md         ← archive of every prompt shipped
```

Discover the project's actual paths from codebase (`public/`, `src/assets/`, etc.) before writing files.

### Each registry file must include

| Field | Purpose |
|-------|---------|
| YAML frontmatter | `id`, `status` (`planned` \| `deployed`), `asset_path`, `component`, `layout` |
| **Paste-ready prompt** | Exact block for ChatGPT / DALL·E / Flux |
| **Site placement** | Component + column (e.g. split right, sidebar) |
| **Layout note** | Negative space, max-width, animation rules |
| **After export** checklist | Figma trace → SVG path → wire component |

### Workflow when user asks for an SVG in a section

1. Check if the project already has a registry — reuse existing prompt if the slot exists.
2. If new: copy [svg-prompts/_template.md](svg-prompts/_template.md) into the project, fill from [SVG prompt formula](#svg-prompt-formula-extra-block).
3. Deliver the **prompt block** to the user (same [Output format](#output-format) as raster images).
4. After SVG lands in the project asset folder, update frontmatter `status: deployed`.
5. **Append the prompt** to the project's done-prompts archive.
6. Wire a thin component (inline SVG). Prefer SMIL for small loops; see **debug skill Bug 6** — no dual `<img>` frame swap.

### Example registry entries (reference only)

| ID | Example file |
|----|--------------|
| `support-illustration` | [svg-prompts/example-support-illustration.md](svg-prompts/example-support-illustration.md) |
| `contact-illustration` | [svg-prompts/example-contact-illustration.md](svg-prompts/example-contact-illustration.md) |

When generating prompts in chat, **output the same paste-ready block** you would store in the project registry so the user can regenerate or share it later.
Every prompt should include these blocks (merge into one paragraph for the user):

```
[SUBJECT] — what to depict, tied to the product/industry
[STYLE] — editorial / photo / isometric / flat; mood adjectives
[PALETTE] — 3–5 hex codes from the project (background, text, primary, accent)
[COMPOSITION] — aspect ratio, negative space for UI copy, subject placement
[CONSTRAINTS] — No text, no logos, no watermarks, no stock clichés (list relevant ones)
[TECHNICAL] — landscape 16:9, 1920×1080 or 1600×900, PNG
```

### Palette discovery

If no tokens exist, ask the user or infer from existing CSS. Always pass **hex codes** in the prompt — model color names drift.

### Universal constraints (default ON)

- No headlines or paragraphs baked into the image (site provides copy)
- No logos or watermarks unless user supplies brand mark for reference
- Avoid generic stock: handshakes, high-fives, fake diverse boardroom
- Avoid wrong palette (e.g. legacy banner greens that don't match site)

## Output format

Deliver prompts like this:

```markdown
### [Role name] — [suggested filename].png
**Use:** [where in the site]
**Layout note:** [one line for dev]
**Figma/SVG:** [only if SVG role — vectorize steps, export path]

\`\`\`
[paste-ready prompt]
\`\`\`
```

After prompts, add a short **file checklist**:
- Export size and format
- Suggested path (`src/imports/hero.png` or project convention)
- Remind user to add meaningful `alt` in components (except decorative backgrounds)

## Role templates

Adapt placeholders `{industry}`, `{scene}`, `{hex_bg}`, `{hex_ink}`, `{hex_primary}`, `{hex_accent}` from the project.

### Hero background

```
Editorial hero {style} for a {industry} website.
Scene: {scene} — authentic to the product, not generic corporate stock.
Style: refined, trustworthy, {mood}; soft texture on backgrounds.
Palette: background {hex_bg}, deep tones {hex_ink}, primary {hex_primary}, accent {hex_accent} only.
No text, no watermarks, no logos, no handshakes.
Composition: landscape 16:9, generous negative space on the {left|right} {fraction} for website headline overlay,
main subject weighted to the opposite side.
1920×1080, high quality.
```

### Diagram / workflow

```
Clean {isometric|flat} diagram for a {industry} website showing: {steps}.
Minimal UI panels, readable labels only if essential ({short labels}).
Palette: background {hex_bg}, lines {hex_ink}, accents {hex_primary} and {hex_accent} only.
No paragraphs of text. Landscape 16:9, professional B2B aesthetic.
```

### Photo / mission card

```
Warm editorial photograph-style image: {scene}.
Soft natural light, shallow depth of field, {setting}.
Color grade: warm neutrals with subtle {hex_primary} and {hex_accent} accent props.
No text overlays, no logos, landscape 16:9, trustworthy, not generic stock.
```

### Section texture

```
Abstract editorial texture for a website section background:
{motifs — grids, layers, subtle industry symbols as line art}.
Palette: {hex_bg}, {hex_ink}, {hex_primary}, {hex_accent} only. No text. Wide 16:9 or 21:9.
```

More examples: [prompt-templates.md](prompt-templates.md)

## When to suggest images vs UI changes

| Situation | Action |
|-----------|--------|
| User asks for prompts | This skill — discover brand, output prompts |
| Text-heavy banner in a crop box | New prompt (no text) **+** background or `object-contain` layout |
| Diagram labels cut off | Fix CSS (`object-contain`), not regenerate |
| Wrong colors in asset | Regenerate with project hex table |
| Only 1–2 images for carousel | Suggest hero background + cards; carousel optional |

## Pre-ship checklist

| Check | |
|-------|---|
| Prompt uses project hex codes | ☐ |
| Role matches layout (bg vs diagram vs card) | ☐ |
| Hero bg has negative space where copy overlays | ☐ |
| Diagram prompt says readable / minimal labels | ☐ |
| SVG prompt: no text, flat fills, plain background | ☐ |
| SVG slot file created in project registry (if applicable) | ☐ |
| User told export size + folder path | ☐ |
| Prompt archived in project done-prompts (if project uses one) | ☐ |

## Anti-patterns

- One generic prompt with no project palette
- `object-cover` on diagrams in the layout note
- Headlines inside images that duplicate the site H1
- Carousel with arrows for 2 slides when a single hero bg works
- Skipping codebase read — prompts that clash with actual brand tokens
- SVG prompts with speech bubbles or paragraphs (unusable after trace — add text in Figma)
- Photorealistic or heavily textured art when user asked for SVG conversion
