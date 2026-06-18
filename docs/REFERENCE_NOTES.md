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
