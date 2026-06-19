# Reference Notes

## Pat Simmons GPT-Realtime 2 OS Agent Demo

Reference: https://x.com/per_simmons_/status/2067051453022363992

Observed direction:

- The interaction model is operating-system-level voice control, not a chat window.
- Push-to-talk is important for an always-resident assistant.
- The assistant should show or preserve a visible tool/runtime activity log.
- Integrations should be tool bridges, such as MCP/app-specific connectors, rather than brittle UI-only automation.
- Useful demos include opening apps, searching the web, connecting to Obsidian, and controlling Premiere Pro.
- Honest caveats matter: local permissions, latency, and action safety should remain visible.

Video anchors:

- `0:00`: Intro.
- `1:46`: What GPT-Realtime 2 changes for OS-level agents.
- `4:46`: No-code setup.
- `7:53`: Push-to-talk / always-on microphone caveat.
- `9:41`: Web search demo.
- `11:38`: MCP app bridge demo with Obsidian.
- `14:13`: Premiere Pro control through the accessibility tree.
- `18:00`: Caveats.

Implications for JAVIS:

- Keep the desktop buddy small and resident.
- Prefer push-to-talk as the default voice mode.
- Make tools first-class and auditable.
- Keep tool execution separate from casual voice interaction.
- Build Accessibility tree control in stages: read tree, plan target, then guarded execution.
- Route high-risk actions through approvals.

## OpenAI Codex Record & Replay, Memories, and Chronicle

References:

- https://x.com/OpenAIDevs/status/2067681320281723113
- https://developers.openai.com/codex/record-and-replay
- https://developers.openai.com/codex/memories
- https://developers.openai.com/codex/memories/chronicle
- https://developers.openai.com/codex/skills

Observed direction:

- Record & Replay turns one demonstrated Mac workflow into a reusable skill.
- Codex skills are the reusable workflow unit: instructions first, optional scripts/references later, loaded only when needed.
- Memories are a local recall layer for stable preferences, recurring workflows, tech stacks, and pitfalls, not the only place for hard rules.
- Chronicle uses recent screen context to help build memories, but it is opt-in and carries privacy, rate-limit, and prompt-injection risks.

Implications for JAVIS:

- Treat "distilling the user" as two separate artifacts: inferred local memory for context and reviewable skills for repeatable workflows.
- Do not silently turn passive observation into hidden instructions. Generate a `SKILL.md` draft that the user can inspect and explicitly export.
- Keep raw screenshots, clipboard contents, page bodies, and secrets out of learned profiles and skill drafts.
- Current JAVIS Record & Replay should capture short, complete, user-initiated workflows with clear variable inputs and verification steps, then expose safe replay plans, reviewable skill drafts, and Realtime evidence before any save or run.
