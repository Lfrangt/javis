# JAVIS Safety

JAVIS controls a real computer, so local actions are treated as a security boundary.

## Default Policy

- Screen capture requires explicit macOS permission.
- API keys and other secrets should be entered through the terminal CUI or edited in `.env` locally; they should not be pasted into chat. The CUI hides API key input and never prints the saved value.
- Live screen context is only sent after the user starts voice/screen context or enables passive ambient capture locally, and it can be toggled off through API/CUI controls.
- Local wake-word integration is trigger-only. `JAVIS_WAKE_ENGINE_CMD` may start a local command that reports a wake event, but the wake path only starts the voice session; it does not execute computer actions by itself.
- Conversation state is renderer-reported lifecycle telemetry for voice sessions. It records connecting/live/idle/error, mic mode, screen-context flag, and heartbeat freshness; it does not grant action permission or execute tools by itself.
- Realtime preflight context is a silent text message, not a user command. It excludes clipboard text, raw ambient event logs, and screenshots; it carries only compact presence, app/browser, screen freshness, active work, next-action, and guardrail summaries.
- Realtime work-progress sync is also silent context. It sends compact `/api/work/progress` summaries only while voice is live and only when work state changes; it does not approve actions, start new work, or interrupt by itself.
- Realtime tool-call evidence is diagnostic only. `/api/realtime/evidence` keeps a short in-memory list of `/api/tools/execute` metadata for dogfood: tool name, source, timing, success/error state, output type/size/keys, and sanitized shortcut-tool fields. It does not store full tool arguments, raw tool outputs, screen frames, page bodies, clipboard text, or permission grants.
- Screen privacy defaults to `private`: resident-captured frames are downscaled and blurred before being posted to the local API or injected into Realtime. API/CUI controls can switch to `clear` when the user wants sharper screen context. `/api/screen/privacy` also stores local app/window/browser-host/region rules. Enabled app/window/browser-host `exclude` rules block screen images from server-side model context; enabled region rules are pixel-masked in the resident process before resident-captured or renderer-posted frames are stored, returned through the API, or injected into Realtime.
- Passive ambient observe is read-only. It records local app/window/browser metadata, and can refresh a private latest screen frame, but it does not speak, click, type, submit, or call model lanes by itself.
- Ambient learning distillation is local and model-free. When enabled, it distills passive metadata into aggregate app/browser/context patterns in `learned-profile.json`; it is separate from explicit user-approved memory and is not a reason to act without a wake or command. API/CUI controls can pause learning, stop prompt inclusion, delete the inferred profile, promote the summary to explicit memory, and exclude apps/sites/folder-like contexts. If prompt inclusion is enabled, only the aggregate summary/signals are added to task prompts, not raw ambient events, screenshots, clipboard text, or page bodies.
- Saving learning into memory uses one upserted `source:"learning"` memory tagged `ambient-profile`. Task prompts label it as inferred local context rather than a user-confirmed preference.
- Learning skill drafts are review artifacts, not automatic permissions. `/api/learning/skill-draft` returns a `SKILL.md` draft from aggregate profile, routing, and workflow evidence without writing files. `/api/learning/skill-draft/save` requires explicit confirmation and writes to user-level `~/.agents/skills`, so private usage patterns do not get committed to the open-source repo by default.
- Local skill recall (`search_local_skills`, `/api/skills/local`, or `/api/learning/skills`) is read-only. It extracts short summaries from local `SKILL.md` files and can add matching procedures plus `skillRecallPlan` evidence to task context, queued worker prompts, job logs, and routing records, but it does not execute the skill, approve actions, install tools, or expand permissions.
- Skill shortcuts are routing hints, not approvals. `/api/shortcuts/promote` and the Realtime `save_skill_shortcut` tool require explicit confirmation before saving a phrase, `/api/shortcuts/candidates` and `get_skill_shortcut_candidates` only suggest completed skill-plan evidence, and a matched shortcut only attaches the stored `skillRecallPlan`; it does not replay UI steps, mutate files, run workers, or bypass action policy, control mode, local execution, or Level 4 confirmation gates.
- Presence state is read-only. It summarizes standby/watch/work/attention status from ambient metadata, wake state, local learning, active jobs, approvals, and policy guardrails; it does not trigger actions by itself.
- Clipboard read/write goes through the action policy and audit log. Realtime should request full clipboard text only when the user asks or when it is clearly required.
- Clipboard-to-Inbox capture reads the current clipboard only when the user presses the capture hotkey, uses the menu bar item, or calls the capture endpoint. It stores the text locally as an Inbox item and does not execute the captured content.
- No-model local commands are convenience routing only. Inbox/status commands stay local, and app/URL/search/narrow app workflow actions still use the same action policy and audit path as model-triggered actions.
- No-model observation commands can refresh the resident screen frame and summarize local metadata such as frontmost app, window title, UI node count, clipboard summary, jobs, and approvals. They do not send the image to a model unless the user asks for a screen description.
- No-model typing workflows are intentionally narrow: they require an explicit text-oriented app target, currently Notes, TextEdit, or Obsidian, and short typed content. They are rejected when the request includes sends, submissions, deletes, logins, payments, passwords, secrets, or a close-window follow-up.
- Inbox triage is read-only. It sorts open captures and suggests lanes, but does not execute, route, mark done, or mutate items.
- Inbox process-next requires an explicit user command, CUI action, API request, or voice tool call. It processes only the highest-priority open item and reuses the normal Inbox router, queue, worker, and completion rules.
- Agent collaboration claims are coordination metadata only. `/api/collaboration` can say that Claude Code, Codex, or a local CLI worker is editing a scope, and the parallel router uses active write claims to avoid overlapping workers, but claims do not grant file permissions, bypass action policy, approve Level 3/4 actions, or replace git review.
- Browser page reading is read-only, policy-limited by character count, and should only be used when the user asks about the active page or page content is clearly needed. It may return visible links and search-result candidates, but reading those links does not click or open them.
- Browser control is limited to navigation actions: back, forward, reload, new tab, close tab, focus address bar, open URL, and search. It does not click page content, submit forms, or enter credentials.
- Browser DOM reading is read-only and returns visible controls with labels/selectors, not raw HTML. It can use browser Apple Events or the local Chrome DevTools bridge on `JAVIS_CHROME_DEBUG_PORT`. Browser DOM actions execute one guarded `click`, `fill`, or `select`; password fields are blocked, and submit/send/buy/delete/login/account-change style targets are Level 4 confirmation actions.
- Browser workflows reuse the read-only page reader and route output to quick/background lanes. `search` and `compare` workflows may navigate the browser to Google result pages through the guarded browser-control lane, then read those result pages and extract candidate result links. `review_result` may open one explicit URL or selected result link through the guarded `open_url` path, then read the target page. `research` may open several explicit URLs or search-result links in sequence, synthesize their read-only snapshots, and persist structured continuation/recovery actions for prepared preview links, unvisited result links, failed pages, or follow-up links found on reviewed pages. These continuation actions are inert API arguments until a later explicit workflow or work-next call runs them; they do not click page controls, type into arbitrary fields, submit forms, or make account changes by themselves.
- CLI tool runs are explicit background jobs. They require local execution, follow `allow.cli_command`, stream output to job logs, and can be cancelled from the jobs API/CUI.
- Accessibility tree reading is read-only, policy-limited by node count and depth, and should be used before planning control of non-browser Mac apps.
- UI action planning is dry-run only. It identifies candidate UI targets and next steps, but does not click, type, submit, or execute.
- Accessibility execution actions (`ax_press`, `ax_set_value`) are Level 3. They require local execution enablement, current Accessibility permission, allowed AX roles, expected role/label checks, and approval when the action policy is in guarded mode.
- Current-app control (`control_current_app` or `/api/accessibility/control`) is a wrapper around UI planning plus one Level 3 Accessibility action. `execute:false` previews the selected target, and `execute:true` still uses the same policy, expected role/label checks, and audit log.
- Browser form-fill drafts (`run_browser_workflow` with `intent:"fill_draft"` or `/api/browser/fill-draft`) match supplied fields to visible DOM controls first. They preview by default, block sensitive fields such as passwords and card numbers, require `confirm:true` for execution, and never submit the form by themselves. Confirmed live fills run a browser-side verification pass that returns matched/partial/unverified status, byte counts, and recovery hints without returning the raw filled values.
- App workflow planning (`plan_app_workflow` or `/api/app/plan`) is planning-first. With `execute:false`, it only returns steps. With `execute:true`, it passes those steps into the normal app workflow executor.
- App workflows (`run_app_workflow` or `/api/app/workflow`) sequence a small number of local steps into one auditable workflow record. `execute:false` previews each step. `execute:true` stops on the first blocked or approval-required step by default, and each action still goes through the normal policy path.
- Demonstration replay planning (`plan_ui_demonstration_replay` or `/api/demonstrations/:id/replay/plan`) converts completed explicit UI demonstrations into app workflow steps that must re-observe the live UI. Demonstration replay execution (`run_ui_demonstration_replay` or `/api/demonstrations/:id/replay/run`) requires `confirm:true` for execution, never reuses saved coordinates, and still goes through app workflow, action policy, control mode, approvals, and audit logging.
- Demonstration skill promotion (`draft_ui_demonstration_skill` or `/api/demonstrations/:id/skill-draft`) is preview-only. Saving (`save_ui_demonstration_skill` or `/api/demonstrations/:id/skill-draft/save`) requires `confirm:true`, writes only to the local user skills directory, stores no screenshots or raw clipboard text, and does not grant new automation permissions.
- Guarded UI action requests go through the same `/api/actions/execute` path. They do not bypass preview, action policy, local execution, or macOS permission checks.
- File workflows reuse policy-guarded list/read/search actions for read-only context. Organization, batch-rename, semantic text-conversion, and copy-convert workflows produce preview plans first; they do not move, copy, or write files by themselves.
- Applying a file plan requires an explicit `confirm:true` request and still goes through the same Level 3 file-action gates. Executed steps record post-action verification for destination existence, bytes/hash matches, and source removal for moves.
- File mutation actions (`write_file`, `create_directory`, `copy_file`, `move_file`) are Level 3. They require local execution enablement, approval when policy requires it, allowed roots, and audit logging.
- Workflow history is stored locally in the runtime directory and may include page titles, URLs, user requests, linked job ids, and generated results.
- Workflow continuation uses local history to create a new answer or queued task; it does not replay actions or execute prior steps automatically. Browser research continuations may include the next URL/search set to review, but work-next only previews them unless explicitly executed.
- Copying a workflow result uses the same clipboard write policy and audit path as any other clipboard action; it does not bypass size limits or approval rules.
- Local memory is stored only when the user explicitly asks JAVIS to remember a durable fact, preference, or project note. It is local to the runtime directory and can be searched or deleted through `/api/memory`. Task routing and manual task queueing include relevant explicit memories by default; API callers can set `useMemory:false` to disable this for a request.
- Work sessions are local, task-scoped context, not durable memory. Session notes are kept in `sessions.json` and surfaced in status/briefing until deleted, but they are not injected as memory preferences unless the user separately asks JAVIS to remember them.
- Work-next runs at most one selected step from the local workbench. It may open setup targets, summarize approvals, check progress/session state, process one Inbox item, or run one explicit routed-work recovery candidate through the same job/workflow/browser/file/app policy gates, but it never approves pending actions or batch-runs tasks by itself.
- Setup actions can create an empty `.env` template and open macOS settings or local runtime files; they do not store API keys, grant permissions, or enable high-permission local execution automatically.
- Setup guide and setup-next only choose which existing setup action to open. They do not bypass macOS consent, write secrets, or change execution policy.
- Local execution is explicit opt-in through `.env` or the terminal CUI. The CUI requires typing `ENABLE` or `DISABLE` before changing `JAVIS_ENABLE_LOCAL_EXEC`.
- Trusted local mode is a separate acknowledgement for a personal workstation. The CUI requires typing `TRUST` before setting `JAVIS_TRUSTED_LOCAL_MODE=true`, enabling local execution, and aligning automatic Level 3 policy. It does not make Level 4 actions automatic.
- Control mode is a runtime posture on top of action policy. `observe_only` blocks Level 2+ actions, `ask_before_action` requires approval for Level 2+ actions, and `trusted_local` / `takeover_supervised` still cannot exceed action-policy allowlists or thresholds.
- File operations can be scoped broadly, such as to `/Users/Haoge`, through `action-policy.json`; macOS Full Disk Access for protected folders still requires the user to approve JAVIS/Electron in System Settings.
- The resident install setup action writes a user LaunchAgent for next login. It does not start another Electron process while the current manual server is running.
- High-permission local execution is off by default.
- Reversible actions come first.
- Purchases, sends, deletes, authenticated changes, and account operations require confirmation.
- Background workers should state what they did and where evidence lives.

## Risk Levels

- Level 0: answer only.
- Level 1: read-only screen or file context.
- Level 2: reversible local actions or state changes, such as opening an app/URL or writing prepared text to the clipboard.
- Level 3: editing local files, typing into apps, or running code agents.
- Level 4: external side effects such as sending messages, submitting forms, payments, deletes, or account changes.

Level 3 requires `JAVIS_ENABLE_LOCAL_EXEC=true`. It can be approval-gated or automatic depending on `maxAutoRiskLevel` and `requireApprovalAtRiskLevel`. Level 4 should always require an explicit user confirmation step.

## Action Policy

The resident server keeps a local policy file:

```text
~/Library/Application Support/JAVIS/Runtime/action-policy.json
```

The resident also keeps a control-mode file:

```text
~/Library/Application Support/JAVIS/Runtime/control-mode.json
```

`/api/control/mode` exposes and updates the current posture:

- `observe_only`: read/status/context actions only; Level 2+ local actions are blocked.
- `ask_before_action`: Level 1 read-only actions can run; Level 2+ actions require approval.
- `trusted_local`: uses the existing action policy for a trusted personal workstation.
- `takeover_supervised`: makes the takeover intent explicit while still keeping Level 4 and policy-disallowed actions gated.

Control mode only tightens the effective thresholds. It does not enable disabled actions, expand allowlists, widen file roots, bypass macOS permissions, or make Level 4 external side effects automatic.

Default behavior:

- Level 2 actions can run automatically when allowed by policy.
- Level 3 actions require `JAVIS_ENABLE_LOCAL_EXEC=true` and require approval unless the policy is intentionally set to auto-run Level 3.
- `JAVIS_ACTION_DRY_RUN=true` previews actions without executing them.
- URL hosts, app names, and hotkeys are controlled by allowlists in the policy file.

Policy knobs:

- `dryRun`: returns what JAVIS would do without doing it.
- `maxAutoRiskLevel`: highest risk level that can run without approval.
- `requireApprovalAtRiskLevel`: risk level at which approval is always required.
- `allow.open_url.allowedHosts`: URL hosts allowed for `open_url`.
- `allow.open_app.allowedApps`: app names allowed for `open_app`.
- `allow.hotkey.allowedKeys`: hotkeys allowed for `hotkey`.
- `allow.read_clipboard.maxBytes`: maximum clipboard text JAVIS may read.
- `allow.write_clipboard.maxBytes`: maximum clipboard text JAVIS may write.
- `allow.clear_clipboard.enabled`: whether JAVIS may clear the clipboard.
- `allow.read_accessibility_tree.maxNodes`: maximum accessibility nodes JAVIS may read from the frontmost app.
- `allow.read_accessibility_tree.maxDepth`: maximum accessibility tree depth JAVIS may traverse.
- `allow.ax_press.allowedRoles`: accessibility roles that may receive `AXPress`.
- `allow.ax_set_value.allowedRoles`: accessibility roles that may receive a value write.
- `allow.ax_set_value.editableEvidenceRequiredRoles`: broad web roles that may only receive `ax_set_value` after the target carries editable evidence such as `AXEditable=true`, `contenteditable`, `textbox`, `searchbox`, or composer/input metadata.
- `allow.ax_set_value.maxBytes`: maximum text JAVIS may write through an accessibility value action.
- `allow.browser_control.allowedActions`: browser navigation actions and guarded DOM actions JAVIS may execute in a supported active browser, including `dom_click`, `dom_fill`, and `dom_select`.
- `allow.code_agent.allowedCommands`: code agent command names JAVIS may launch as background jobs, such as `codex` or `claude`.
- `allow.code_agent.maxTimeoutMs`: maximum runtime for one code agent job before JAVIS stops it.
- `allow.cli_command.allowedCommands`: CLI command names JAVIS may launch as background jobs. `*` means trusted local mode.
- `allow.cli_command.maxTimeoutMs`: maximum runtime for one CLI job before JAVIS stops it.
- `allow.read_browser_page.maxChars`: maximum active-tab page text JAVIS may return; visible links are capped separately by `JAVIS_MAX_BROWSER_PAGE_LINKS`.
- `allow.list_directory.allowedRoots`: directories where JAVIS may list files.
- `allow.read_file.allowedRoots`: directories where JAVIS may read files.
- `allow.search_files.allowedRoots`: directories where JAVIS may search files.
- `allow.write_file.allowedRoots`: directories where JAVIS may write files.
- `allow.create_directory.allowedRoots`: directories where JAVIS may create folders.
- `allow.copy_file.allowedRoots`: directories where JAVIS may copy files into.
- `allow.copy_file.maxBytes`: maximum source file size JAVIS may copy.
- `allow.move_file.allowedRoots`: directories where JAVIS may move or rename files within.

Default file policy:

- Read-only file actions are Level 1.
- `write_file`, `create_directory`, `copy_file`, and `move_file` are Level 3, require approval, and require `JAVIS_ENABLE_LOCAL_EXEC=true`.
- `ax_press` and `ax_set_value` are Level 3, require approval, and require `JAVIS_ENABLE_LOCAL_EXEC=true`.
- `ax_set_value` supports web roles such as `AXGroup`, `AXStaticText`, and `AXWebArea` for Chromium contenteditables, but previews and executions require editable evidence and live execution re-checks the current target before writing.
- Codex and Claude Code delegation is Level 3, requires `JAVIS_ENABLE_LOCAL_EXEC=true`, and is governed by `allow.code_agent`.
- App workflow approvals store only the remaining workflow steps needed to continue after the approved action; later steps still re-enter the same policy checks.
- Failed jobs keep `attempts`, `failureKind`, and `recoveryPlan` with a redacted diagnostics snapshot so JAVIS can diagnose and continue instead of returning a bare failure.
- Work-next recovery jobs are capped by `JAVIS_MAX_RECOVERY_JOB_ATTEMPTS` per failed parent job and keep Level 3 code-agent policy checks.
- Autopilot ticks are limited to low-risk recovery diagnostics and safe-planner app workflow retries; they skip during live voice sessions or active background jobs.
- Collaboration claims expire after `JAVIS_COLLABORATION_CLAIM_TTL_MS` when a worker stops heartbeating. Expiration only releases the coordination claim; it does not revert files or decide whether the worker's changes are correct.
- Read/list/search default roots are the current project, Desktop, Documents, and Downloads.
- Write/create/copy/move default roots are the current project only in guarded mode.
- In trusted local mode, project-only write roots are upgraded to the current project, Desktop, Documents, and Downloads unless `JAVIS_ALLOWED_WRITE_ROOTS` or a custom action policy says otherwise.

Current high-autonomy local setup:

- `JAVIS_ENABLE_LOCAL_EXEC=true`
- `JAVIS_TRUSTED_LOCAL_MODE=true`
- `maxAutoRiskLevel=3`
- `requireApprovalAtRiskLevel=4`
- file write roots cover the project, Desktop, Documents, and Downloads by default
- Level 4 actions remain outside automatic execution

## Approval Queue

The resident server keeps approval records locally:

```text
~/Library/Application Support/JAVIS/Runtime/approvals.json
```

Pending approvals can be reviewed from the terminal CUI or through the API. Approving an action re-evaluates current policy before execution, so tightening the policy also protects already queued approvals.
