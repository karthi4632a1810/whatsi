---
name: obsidian-vaults
description: >-
  Navigate Obsidian wiki-link vaults (Engineering DNA, Developer DNA) for
  engineering profile, architecture, patterns, and style guidance. Use when
  tasks need developer DNA, backend/AI conventions, frontend CSS/UX patterns,
  or when vault notes contain [[wikilinks]].
---

# Obsidian Vault Navigation

Two knowledge vaults document this engineer's DNA using Obsidian `[[wikilinks]]`. Treat wikilinks as **file references**, not URLs.

## Vaults

| Vault | Scope |
|-------|-------|
| **Engineering DNA** | Full-stack: AI pipelines, backend, database, API design, security, performance (six production repos) |
| **Developer DNA** | Frontend: CSS motion, UX, React patterns, reusable UI blueprints |

Locate a vault by folder name, then open its `README.md`.

## Resolve wikilinks

```
[[Note Title]]       →  {vault}/{Note Title}.md
[[Note Title|label]] →  same file; ignore the label
```

Filenames match note titles exactly (including spaces). If a link fails, search the vault folder for that title.

## Navigation workflow

1. Open the vault `README.md` — pick a target from the file table or task routing below.
2. Read the entry note: `[[Engineering Profile]]` or `[[Developer Profile]]`.
3. Follow `**Related:** [[A]] · [[B]] · …` at the top of each note for lateral hops.
4. Stop after 1 index + 1–3 targeted notes unless the user asks for more depth.
5. In chat, cite note titles (e.g. *Security*, *CSS Philosophy*) — not raw `[[wikilinks]]`.

## Task routing — Engineering DNA

| Task | Read in order |
|------|---------------|
| Onboard / general context | [[Engineering Profile]] → [[Software Architecture]] → domain note |
| NexusPath / LMS | [[Backend Engineering]] → [[Database Engineering]] → [[API Design]] → [[AI Engineering]] |
| Face Finder / ANPR / CV | [[AI Engineering]] → [[Performance]] → [[Debugging]] |
| MAPIMS / Iink / VocalAng | [[AI Engineering]] → [[Backend Engineering]] → [[Performance]] |
| Security review | [[Security]] → [[Weaknesses]] |
| Sprint / debt planning | [[Weaknesses]] → [[Learning Roadmap]] |
| Auth / RBAC gaps | [[Security]] → [[Backend Engineering]] → [[API Design]] |

## Task routing — Developer DNA

| Task | Read in order |
|------|---------------|
| New UI / visual design | [[UI Philosophy]] → [[CSS Philosophy]] → [[Reusable Patterns]] |
| CSS / animation work | [[CSS Philosophy]] → [[Performance]] → [[Reusable Patterns]] |
| React / JS patterns | [[JavaScript Style]] → [[Architecture]] → [[Reusable Patterns]] |
| UX / interaction | [[UX Decisions]] → [[CSS Philosophy]] → [[JavaScript Style]] |
| Project structure | [[Architecture]] → [[JavaScript Style]] |
| Code review / debt | [[Weaknesses]] → [[Learning Roadmap]] → [[Skill Tree]] |

## Cross-vault

Use **Engineering DNA** for systems/backend/AI work and **Developer DNA** for UI/motion/CSS. For full-stack features, read from both — start with the layer you're implementing.

## Link conventions

- `**Related:**` at note top — primary navigation path for agents
- README file tables — pick targets; do not read every linked note
- Mermaid graphs in README — orientation only; follow wikilinks for detail
- Some Engineering DNA notes still have footer `See [[X]]` links — treat as secondary to **Related:**
