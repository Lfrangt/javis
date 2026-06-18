# JAVIS Safety

JAVIS controls a real computer, so local actions are treated as a security boundary.

## Default Policy

- Screen capture requires explicit macOS permission.
- API keys and other secrets should be entered through the terminal CUI or edited in `.env` locally; they should not be pasted into chat. The CUI hides API key input and never prints the saved value.
- Live screen context is only sent after the user starts voice/screen context or enables passive ambient capture locally, and it can be toggled off through API/CUI controls.
- Local wake-word integration is trigger-only. `JAVIS_WAKE_ENGINE_CMD` may start a local command that reports a wake event, but the wake path only starts the voice session; it does not execute computer actions by itself.
- Screen privacy defaults to `private`: resident-captured frames are downscaled and blurred before being posted to the local API or injected into Realtime. API/CUI controls can switch to `clear` when the user wants sharper screen context.
- Passive ambient observe is read-only. It records local app/window/browser metadata, and can refresh a private latest screen frame, but it does not speak, click, type, submit, or call model lanes by itself.
- Clipboard read/write goes through the action policy and audit log. Realtime should request full clipboard text only when the user asks or when it is clearly required.
- Clipboard-to-Inbox capture reads the current clipboard only when the user presses the capture hotkey, uses the menu bar item, or calls the capture endpoint. It stores the text locally as an Inbox item and does not execute the captured content.
- No-model local commands are convenience routing only. Inbox/status commands stay local, and app/URL/search/narrow app workflow actions still use the same action policy and audit path as model-triggered actions.
- No-model observation commands can refresh the resident screen frame and summarize local metadata such as frontmost app, window title, UI node count, clipboard summary, jobs, and approvals. They do not send the image to a model unless the user asks for a screen description.
- No-model typing workflows are intentionally narrow: they require an explicit text-oriented app target, currently Notes, TextEdit, or Obsidian, and short typed content. They are rejected when the request includes sends, submissions, deletes, logins, payments, passwords, secrets, or a close-window follow-up.
- Inbox triage is read-only. It sorts open captures and suggests lanes, but does not execute, route, mark done, or mutate items.
- Inbox process-next requires an explicit user command, CUI action, API request, or voice tool call. It processes only the highest-priority open item and reuses the normal Inbox router, queue, worker, and completion rules.
- Browser page reading is read-only, policy-limited by character count, and should only be used when the user asks about the active page or page content is clearly needed.
- Browser control is limited to navigation actions: back, forward, reload, new tab, close tab, focus address bar, open URL, and search. It does not click page content, submit forms, or enter credentials.
- Browser workflows reuse the read-only page reader and route output to quick/background lanes; they do not click, type, submit, or change the page by themselves.
- CLI tool runs are explicit background jobs. They require local execution, follow `allow.cli_command`, stream output to job logs, and can be cancelled from the jobs API/CUI.
- Accessibility tree reading is read-only, policy-limited by node count and depth, and should be used before planning control of non-browser Mac apps.
- UI action planning is dry-run only. It identifies candidate UI targets and next steps, but does not click, type, submit, or execute.
- Accessibility execution actions (`ax_press`, `ax_set_value`) are Level 3. They require local execution enablement, current Accessibility permission, allowed AX roles, expected role/label checks, and approval when the action policy is in guarded mode.
- Current-app control (`control_current_app` or `/api/accessibility/control`) is a wrapper around UI planning plus one Level 3 Accessibility action. `execute:false` previews the selected target, and `execute:true` still uses the same policy, expected role/label checks, and audit log.
- App workflow planning (`plan_app_workflow` or `/api/app/plan`) is planning-first. With `execute:false`, it only returns steps. With `execute:true`, it passes those steps into the normal app workflow executor.
- App workflows (`run_app_workflow` or `/api/app/workflow`) sequence a small number of local steps into one auditable workflow record. `execute:false` previews each step. `execute:true` stops on the first blocked or approval-required step by default, and each action still goes through the normal policy path.
- Guarded UI action requests go through the same `/api/actions/execute` path. They do not bypass preview, action policy, local execution, or macOS permission checks.
- File workflows reuse policy-guarded list/read/search actions for read-only context. Organization workflows produce preview plans first; they do not move files by themselves.
- Applying a file organization plan requires an explicit `confirm:true` request and still goes through the same Level 3 file-action gates.
- File mutation actions (`write_file`, `create_directory`, `copy_file`, `move_file`) are Level 3. They require local execution enablement, approval when policy requires it, allowed roots, and audit logging.
- Workflow history is stored locally in the runtime directory and may include page titles, URLs, user requests, linked job ids, and generated results.
- Workflow continuation uses local history to create a new answer or queued task; it does not replay actions or execute prior steps automatically.
- Copying a workflow result uses the same clipboard write policy and audit path as any other clipboard action; it does not bypass size limits or approval rules.
- Local memory is stored only when the user explicitly asks JAVIS to remember a durable fact, preference, or project note. It is local to the runtime directory and can be searched or deleted through `/api/memory`. Task routing and manual task queueing include relevant explicit memories by default; API callers can set `useMemory:false` to disable this for a request.
- Work sessions are local, task-scoped context, not durable memory. Session notes are kept in `sessions.json` and surfaced in status/briefing until deleted, but they are not injected as memory preferences unless the user separately asks JAVIS to remember them.
- Work-next runs at most one selected step from the local workbench. It may open setup targets, summarize approvals, check progress/session state, or process one Inbox item, but it never approves pending actions or batch-runs tasks by itself.
- Setup actions can create an empty `.env` template and open macOS settings or local runtime files; they do not store API keys, grant permissions, or enable high-permission local execution automatically.
- Setup guide and setup-next only choose which existing setup action to open. They do not bypass macOS consent, write secrets, or change execution policy.
- Local execution is explicit opt-in through `.env` or the terminal CUI. The CUI requires typing `ENABLE` or `DISABLE` before changing `JAVIS_ENABLE_LOCAL_EXEC`.
- Trusted local mode is a separate acknowledgement for a personal workstation. The CUI requires typing `TRUST` before setting `JAVIS_TRUSTED_LOCAL_MODE=true`, enabling local execution, and aligning automatic Level 3 policy. It does not make Level 4 actions automatic.
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
- `allow.ax_set_value.maxBytes`: maximum text JAVIS may write through an accessibility value action.
- `allow.browser_control.allowedActions`: browser navigation actions JAVIS may execute in a supported active browser.
- `allow.cli_command.allowedCommands`: CLI command names JAVIS may launch as background jobs. `*` means trusted local mode.
- `allow.cli_command.maxTimeoutMs`: maximum runtime for one CLI job before JAVIS stops it.
- `allow.read_browser_page.maxChars`: maximum active-tab page text JAVIS may return.
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
- Read/list/search default roots are the current project, Desktop, Documents, and Downloads.
- Write/create/copy/move default roots are the current project only.

Current high-autonomy local setup:

- `JAVIS_ENABLE_LOCAL_EXEC=true`
- `JAVIS_TRUSTED_LOCAL_MODE=true`
- `maxAutoRiskLevel=3`
- `requireApprovalAtRiskLevel=4`
- file roots are scoped to `/Users/Haoge`
- Level 4 actions remain outside automatic execution

## Approval Queue

The resident server keeps approval records locally:

```text
~/Library/Application Support/JAVIS/Runtime/approvals.json
```

Pending approvals can be reviewed from the terminal CUI or through the API. Approving an action re-evaluates current policy before execution, so tightening the policy also protects already queued approvals.
