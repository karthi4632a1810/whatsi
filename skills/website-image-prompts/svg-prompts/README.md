# SVG prompt registry (examples)

Reference examples for the **website-image-prompts** skill. Copy `_template.md` when starting a new slot in **your project** — not here.

## Per-project layout (create in the codebase)

```
src/assets/illustrations/     ← exported SVG files
prompts/svg/                    ← one .md per slot in the project repo
prompts/done-prompts.md         ← archive of every prompt shipped
```

## Example entries (this skill folder)

| ID | Layout | File |
|----|--------|------|
| `support-illustration` | Split section, illustration right | [example-support-illustration.md](example-support-illustration.md) |
| `contact-illustration` | Sidebar above contact cards | [example-contact-illustration.md](example-contact-illustration.md) |

## Adding a new SVG slot (any project)

1. Copy `_template.md` → `{project}-prompts/{section-slug}.md` in the **project repo**
2. Fill metadata, paste-ready prompt, and site placement
3. Generate → Figma trace → export SVG to asset folder
4. Wire component; update status to `deployed`
5. Append prompt text to project's done-prompts archive

See [SKILL.md](../SKILL.md) for the full workflow.

## Universal rules (all SVG prompts)

- Flat / isometric vector — **no photorealism**
- **6 colors max**, hex codes from project tokens
- **No text** in the image (copy lives in code/Figma)
- Plain solid background or transparent after export
- **1024×1024** unless the layout needs 4:3
- Composition: subject left/center, calm empty area where site copy sits
