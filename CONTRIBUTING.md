# Contributing to Wind Comic

Thanks for thinking about contributing! Wind Comic is a multi-agent AI pipeline for short-form drama production — script → storyboards → video, with built-in character consistency. Contributions of all sizes are welcome.

## Quick start

```bash
git clone https://github.com/ChrisChen667788/wind-comic.git
cd wind-comic
npm install
cp .env.example .env.local        # fill in your AI provider keys
npm run dev                       # http://localhost:3000
```

Run the test + typecheck loop before opening a PR:

```bash
npm run test         # vitest, 3000+ tests
npm run typecheck    # tsc --noEmit, must be 0 errors
```

## Project structure

```
app/                    Next.js 16 App Router pages + API routes
components/             React components (most are colocated by feature)
services/               Long-running pipelines (orchestrator, video, MJ, Minimax, Veo, TTS)
lib/                    Pure utilities (consistency-policy, character-traits, polish-prompts, ...)
tests/                  Vitest unit + integration tests
scripts/                One-shot dev/maintenance scripts
docs/                   User-facing docs and benchmarks
```

The single most important file is [`services/hybrid-orchestrator.ts`](services/hybrid-orchestrator.ts) — the LLM-driven pipeline that routes script → storyboards → image gen → video gen → composition.

## Where to start

Look for issues tagged `good first issue` or `help wanted`. The current sprint roadmap lives in [ROADMAP.md](ROADMAP.md) — the open Sprint A items (A.2 / A.3 / A.4) are well-scoped and a great starting point if you want a meaningful first contribution.

## Pull request checklist

- [ ] Branch from `main`, with a descriptive name (`feat/cameo-bible-persistence`, `fix/ttspipeline-empty-text`)
- [ ] Tests pass: `npm test` (3000+ green)
- [ ] Typecheck clean: `npm run typecheck` (0 errors)
- [ ] Self-contained — no leftover `console.log`, no commented-out code, no `.env.local` changes
- [ ] If you touched a service in `services/`, add or update at least one integration test in `tests/`
- [ ] If you added a new env var, document it in `.env.example` with an inline comment

## Commit messages

Conventional commits, lowercase scope:

```
feat(cameo): auto-retry on consistency score < 75
fix(orchestrator): handle TTS timeout without dropping frames
docs(readme): clarify minimax tts model version
test(polish): add edge cases for diff algorithm
```

`Co-Authored-By: <name> <email>` trailers are welcome and expected when you co-developed a change with an LLM coding agent.

## House style & agent contracts

A few conventions keep the multi-agent pipeline maintainable. Follow them and your PR will read like the rest of the codebase:

- **Don't break the agent contracts.** Each agent's input/output shapes are declared in [`types/agents.ts`](types/agents.ts). The orchestrator wires agents together assuming those shapes — change a shape only with a matching update to every producer/consumer, and add a test that locks the new contract.
- **Pure logic in `lib/`, side effects in `services/`.** Anything decidable without the network (routing, prompt building, parsing, scoring, filter construction) belongs in `lib/` as a pure, unit-tested function. `services/` wraps the actual API/ffmpeg/DB calls. This split is why most of the suite is fast, deterministic unit tests.
- **Every external call has a fallback, and degradation is honest.** LLM / vision / image / video dispatch all run through cross-gateway fallback chains (see the router in `hybrid-orchestrator.ts`). When a shot degrades (retry, B-roll or Ken Burns fallback, missing video), record it in the quality ledger so the final report tells the truth instead of silently shipping a worse film. Never swallow a degrade to make a green number.
- **Match the surrounding code.** Same naming, comment density, and idiom as the file you're editing. Comments state constraints the code can't show — not narration of what the next line does.
- **Keys never leave `.env.local`.** No key values in commits, logs, or test fixtures. New env vars are documented in `.env.example` with an inline comment.

## Adding a new AI provider

Wind Comic abstracts each provider behind a service module in `services/`. To add one:

1. Create `services/<provider>.service.ts` exporting an async function with the same signature as siblings (e.g., `generateImage(prompt, opts)` → `Promise<string>`)
2. Wire it into [`services/hybrid-orchestrator.ts`](services/hybrid-orchestrator.ts)'s router as a fallback in the appropriate chain (image / video / TTS)
3. Add the env var to `lib/config.ts` under `API_CONFIG.<provider>`
4. Document it in `.env.example`
5. Add a smoke test under `tests/` (a minimal mock-or-skip-if-no-key pattern is fine)

## Running marketing/asset scripts

Wind Comic ships with image-generation scripts under `scripts/` for marketing assets (banner, OG card, demo). They require a working `QINGYUNTOP_API_KEY` (or `OPENAI_API_KEY` against any OpenAI-compatible image endpoint). See `scripts/generate-marketing-assets.mjs` for the canonical example.

## Licensing

By contributing, you agree your contributions will be licensed under the [MIT License](LICENSE).
