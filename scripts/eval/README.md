# JAVIS verification

Repeatable checks for the resident agent. Runtime checks talk to the live local
API (`http://127.0.0.1:3417` by default) and auto-discover the API token the same
way as `scripts/doctor.mjs` (`JAVIS_API_TOKEN[_FILE]`, `Runtime/api-token`,
`JAVIS_API_PORT`). Start JAVIS first: `npm run desktop`.

| Command | What it checks | Side effects |
|---------|----------------|--------------|
| `npm run doctor` | Resident readiness, permissions, policy, runtime state | read-only |
| `npm run eval` | Full lane scorecard (health, Realtime, briefing, routing, parallel, learning, safety, workers, AX, ...) | read-only previews + routing records + temporary collaboration claim + temporary control-mode restore |
| `npm run eval -- --only=realtime,parallel,safety,workers` | Run specific lanes (`--list` to see them) | preview routes for routing/parallel lanes |
| `npm run eval -- --only=realtime-injection` | Renderer and resident Realtime progress injection regression: grouped worker context, stale skip, no forced response, runtime evidence | temporary conversation state when no live user session is active |
| `npm run dogfood:browser-live-fill` | Opt-in live browser fill dogfood: opens a temporary local form, runs confirmed `fill_draft`, verifies matched fields, and proves no submit happened | opens/manipulates a supported browser tab |
| `JAVIS_EVAL_REALTIME_DOGFOOD=true npm run eval -- --only=realtime-live-dogfood` | Opt-in live Realtime dogfood: simulated live session, real Codex + Claude + local workers, progress injection receipt, short spoken progress summary | queues real local workers + temporary conversation state when no live user session is active |
| `JAVIS_EVAL_LIVE_WORKERS=true npm run eval -- --only=workers-live` | Opt-in live worker batch: Codex + Claude + local CLI read-only jobs | queues real local workers |
| `npm run eval:json` | Machine-readable scorecard | — |
| `npm run eval:routing` | Lane-classifier accuracy over a labeled corpus | preview routes; appends local routing records |
| `npm run verify:ax` | Accessibility targeting smoke (web-content editables) | read-only |
| `npm run verify:ax -- --require-chromium --execute` | Gemini-composer acceptance: types + verifies | **types into the focused field** |

`npm run eval` exits non-zero if any check fails; safe to wire into a pre-ship gate.

## Scorecard model

Each check returns `pass` / `warn` / `fail` / `skip`. Score weights: pass = 1,
warn = 0.5, fail = 0; skip is excluded. Lanes and the overall score are the mean.

## Add a lane check

Drop a module in `scripts/eval/checks/<lane>.mjs` — `run.mjs` auto-discovers it:

```js
import { ok, warn, fail, skip, assert } from '../_client.mjs';

export default {
  lane: 'mylane',
  async run(ctx) {
    const r = await ctx.api('/api/something');           // { status, ok, data }
    return [assert(r.ok, 'mylane.read', 'My check', 'ok', `HTTP ${r.status}`)];
  },
};
```

Keep checks **read-only or preview-only** (`execute: false`). Anything that
mutates must clean up after itself (see `checks/collaboration.mjs`, which claims
and then releases a temporary write scope, and `checks/control.mjs`, which
restores the previous control mode).

The eval lanes that start real workers are `workers-live` and `realtime-live-dogfood`.
They return `skip` unless their explicit opt-in environment variables are set.

## AX targeting acceptance

The Gemini-composer fix (`docs/issues/2026-06-17-gemini-pane-ax-targeting.md`)
can only be fully verified on a live page. Focus Chrome with the Gemini pane
docked right, then:

```bash
npm run verify:ax -- --require-chromium --execute --content "hello from JAVIS"
```

Pass means the composer is targeted, typed into, and the value re-read confirms
it — covering activation (A), reach (B), settable roles + keystroke fallback (C),
label match (D), and focus + verify (E). See
`docs/issues/2026-06-18-ax-targeting-verification.md`.
