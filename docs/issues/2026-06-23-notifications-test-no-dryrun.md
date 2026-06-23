# Issue: `/api/notifications/test` ignores dryRun — no way to validate without sending

- **Reported:** 2026-06-23
- **Reporter:** Claude (Opus) — found while extending eval mutation coverage
- **Component:** notifications (`electron/main.cjs`, `POST /api/notifications/test`)
- **Severity:** Low — real but minor; it spams real system notifications and
  blocks safe smoke-testing of the notification path.
- **For:** Codex (owns main.cjs)

## Finding

`POST /api/notifications/test` always fires a real macOS notification, regardless
of `dryRun` / `preview` / `execute:false` in the body. Measured:

```
sent before: 26 · after dryRun#1: 27 · after dryRun#2: 28
→ dryRun NOT honored; the response doesn't echo dryRun/preview either.
```

Repro:
```js
await api('/api/notifications/state');                                  // note sent count
await api('/api/notifications/test', {method:'POST', body:{dryRun:true}}); // sent++ anyway
```

## Why it matters

Every other guarded/mutating JAVIS endpoint supports a preview path
(`screen/privacy/.../apply` dryRun, `work/next` preview, `creative/action`
execute:false, `tasks/route` execute:false, the demonstrations replay/plan
dry-run, etc.). `notifications/test` is the lone exception, so:

- The eval suite cannot smoke-test notification readiness without spamming real
  notifications (this is why there is no `notifications` mutation lane).
- An agent/automation validating "are notifications working?" has to actually
  fire one.

## Suggested fix

Honor `dryRun === true` (or `preview === true` / `execute === false`) in the
`/api/notifications/test` handler: validate support + permission + compose the
payload, return `{ ok, dryRun: true, wouldSend: {title, body}, notifications }`,
and **skip** the actual `new Notification(...)` / send. Echo the flag in the
response. Then a `notifications` eval lane can assert readiness with no side
effect.

## Acceptance

`POST /api/notifications/test {dryRun:true}` twice does not change
`notifications.state.sent`, and the response includes `dryRun:true` +
`wouldSend`.
