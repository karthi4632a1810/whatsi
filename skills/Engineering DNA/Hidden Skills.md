# Hidden Skills

**Related:** [[Skill Matrix]] · [[Engineering Profile]] · [[AI Engineering]]

---

## Cross-Project Capabilities

Skills inferred from **Face Finder + NexusPath + Iink + MAPIMS + VocalAng + KVCET ANPR** — often spanning roles labeled separately in org charts.

---

## Face Recognition / Biometric Search ★★★★

**Face Finder-specific:**
- ArcFace 512-d embedding pipeline via InsightFace
- Cosine similarity 1:N search across filesystem image corpus
- CUDA/ONNX Runtime bootstrap for GPU inference on Linux
- Landmark mesh generation (106-point + Delaunay) for visual confirmation
- SSE streaming for long-running batch inference jobs
- Client-side SSE parser with REST degradation path

**Hidden skill:** Building **privacy-preserving local face search** — alternative to cloud Rekognition for personal/event photo workflows.

Combined with VocalAng InsightFace usage and KVCET ANPR — **three distinct CV search patterns** (faces, plates, documents).

---

## Computer Vision / ANPR Engineering ★★★★

**KVCET ANPR-specific:**
- Two-stage detect-then-read pipeline (YOLO + PaddleOCR)
- Classical preprocessing chain (CLAHE, denoise, upscale) for OCR quality
- Spatial gating with polygon ROI and point-in-polygon filtering
- Hybrid GPU/CPU inference scheduling on consumer hardware
- Real-time video processing with Qt timer loop
- Custom fine-tuned detector weights (`best.pt`) — not off-the-shelf COCO

**Hidden skill:** Building **operational CV systems** for physical environments (campus gates) — not just notebook inference demos.

Combined with Iink document OCR and VocalAng InsightFace — **multi-modal vision engineer** spanning documents, faces, and license plates.

---

## SSE / Streaming Protocol Engineering ★★★★

**Face Finder + Iink:**
- Server-side Python generators yielding typed SSE events
- Client-side manual stream parsing (not EventSource — POST body required)
- Proxy buffering headers (`X-Accel-Buffering: no`)
- Fail-forward to REST when stream unavailable

**Hidden skill:** Implementing **progressive result delivery** for batch ML inference without WebSocket complexity.

---

## Full-Stack Product Engineering ★★★★★

**NexusPath-specific:**
- Next.js App Router full-stack monolith — UI + API + ORM in one repo
- Role-based multi-portal architecture (admin/faculty/student/lms)
- End-to-end feature: Gemini roadmap → DB persist → student assignment → daily quiz → performance tracking
- Monaco code editor + Judge0 sandbox integration
- Certificate upload/review workflow with binary storage

**Hidden skill:** Building **complete institutional products** solo — not just API backends or React frontends.

---

## EdTech / LMS Domain ★★★★★

**NexusPath proves depth:**
- Adaptive assessment with performance categories and weak area tracking
- Career path orchestration across departments and academic years
- Faculty-student messaging with notification orchestration
- Workshop/course/assignment enrollment lifecycle
- Industry mentor talks with attendance and feedback
- Code test sessions with per-question scoring and hint tracking

Combined with VocalAng interview prep and Iink educational publishing — **education vertical specialist**.

---

## Real-Time Systems ★★★★

**NexusPath:** Socket.IO rooms, typing indicators, JWT auth on connect.
**VocalAng:** FastRTC WebRTC, EventSource, barge-in.
**MAPIMS:** Deferred worker polling.

**Hidden skill:** Choosing **appropriate real-time transport** per use case — WebRTC for audio, Socket.IO for chat, SSE for job progress, HTTP poll for Judge0.

---

## GPU Resource Orchestration ★★★★★

**VocalAng + Iink:** Model hot-swap, VRAM discipline, int8 quantization.
**NexusPath:** Cloud GPU avoidance — Gemini API offloads inference ops.

**Hidden skill:** Knowing when **not** to run local GPU — cloud LLM for content generation, local GPU for latency-sensitive voice/OCR.

---

## System Design ★★★★★

**NexusPath:** 30-model Prisma schema, role portals, cron notification batch, JSON-in-document AI storage.
**MAPIMS:** Lite/detail API, incremental sync, offline outbox.
**VocalAng:** Session-scoped state, offline monolith.
**Iink:** Hybrid Mongo + FS, SSE protocol.

**Hidden skill:** **Persistence tier selection** — Mongo document vs JSON string vs binary Bytes vs file vs memory vs none.

---

## AI / ML Engineering ★★★★★

**Four modalities:**
- Structured text generation (NexusPath Gemini)
- Vision-language OCR (Iink)
- LLM triage/extraction (MAPIMS)
- STT → LLM → TTS real-time (VocalAng)

**Hidden skill:** **LLM as content factory and workflow engine** — not chatbot tutorials.

---

## API Rate Limit Engineering ★★★★

**NexusPath:** RequestQueueManager, 429 backoff, daily quota tracking, response cache.
**MAPIMS:** Deferred OpenRouter worker.

**Hidden skill:** Designing for **free tier constraints** from day one — not discovering limits in production.

---

## Speech / Voice AI ★★★★★

VocalAng full pipeline + MAPIMS Tamil Sarvam STT — depth beyond API wrapper calls.

---

## Technical Writing ★★★★★

- `TECHNICAL_DOCUMENTATION.md` — comprehensive NexusPath guide
- `COMPLETE_PROJECT_DOCUMENTATION.md` — 20-section project doc
- `task.md` — 48-task build log with verification
- Engineering DNA vault (this Obsidian vault)
- VocalAng `BACKUP_LATEST_DOCUMENTATION.md`

**Hidden skill:** **Documentation as development artifact** — not afterthought README.

---

## AI-Assisted Development Workflow ★★★★

**NexusPath / Profectus rules:**
- `.cursor/rules/nexus.mdc` — Cursor AI workflow methodology
- Prescribed prompts in TASKS.md — consistency over improvisation
- Verification comments on completed tasks

**Hidden skill:** **Engineering process design for AI co-pilots** — treating prompts as linter for development practices.

---

## Integration Engineering ★★★★

| Integration | Project |
|-------------|---------|
| Google Gemini REST | NexusPath |
| Judge0 RapidAPI | NexusPath |
| OpenRouter | MAPIMS |
| Ollama local | VocalAng |
| EMR SOAP | MAPIMS |
| vLLM / Chandra | Iink |
| Sarvam STT | MAPIMS |

---

## Product / Workflow Design ★★★★★

| Workflow | Project |
|----------|---------|
| Roadmap → assign → quiz → track | NexusPath |
| Submit → review → revert → re-OCR | Iink |
| Feedback → AI split → ticket → HOD | MAPIMS |
| Speak → validate → retry → report | VocalAng |
| Frame → detect → OCR → dedup → CSV audit | KVCET ANPR |

Five distinct **state-machine-driven** user journeys.

---

## Skills Less Evident

- Kubernetes / multi-region deploy
- Formal ML evaluation harness
- HIPAA/FERPA hardening
- Native mobile
- RAG / vector search
- GraphQL / tRPC

See [[Skill Matrix]] for numeric ratings.
