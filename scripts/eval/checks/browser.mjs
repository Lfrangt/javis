import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'browser',
  async run(ctx) {
    const out = [];

    const context = await ctx.api('/api/browser/context');
    const c = context.data?.context;
    out.push(
      context.ok && c
        ? ok('browser.context', 'Browser context', c.available ? `${c.app || 'browser'} · ${c.title || c.url || 'active tab'}` : 'no supported active browser tab', { available: c.available })
        : warn('browser.context', 'Browser context', `GET /api/browser/context ${context.status} ${context.error || ''}`),
    );

    const readiness = await ctx.api('/api/browser/readiness');
    const r = readiness.data?.readiness;
    out.push(
      readiness.ok &&
        r?.version === 1 &&
        r?.defaultTarget?.asksWhichWindow === false &&
        r?.defaultTarget?.mode &&
        r?.safety?.readOnly === true &&
        r?.safety?.startsBrowser === false &&
        r?.safety?.executesBrowserActions === false &&
        r?.safety?.executesPageJavaScript === false &&
        r?.safety?.readsPageText === false &&
        r?.capabilities?.context?.endpoint === '/api/browser/context' &&
        r?.capabilities?.page?.endpoint === '/api/browser/page' &&
        r?.commands?.prepare === 'npm run browser:prepare' &&
        r?.commands?.readiness === 'npm run browser:ready' &&
        Array.isArray(r?.endpoints) &&
        r.endpoints.includes('/api/browser/prepare') &&
        Array.isArray(r?.nextActions)
        ? ok('browser.readiness', 'Browser readiness packet', `${r.status || 'unknown'} · default=${r.defaultTarget.mode} · no window picker`)
        : fail('browser.readiness', 'Browser readiness packet', `GET /api/browser/readiness ${readiness.status}`, readiness.data),
    );

    const preparePreview = await ctx.api('/api/browser/prepare', {
      method: 'POST',
      body: {
        execute: false,
        source: 'eval_browser_prepare_preview',
      },
    });
    const prepare = preparePreview.data?.prepare || {};
    out.push(
      preparePreview.ok &&
        prepare.ok === true &&
        prepare.executed === false &&
        prepare.preview === true &&
        prepare.action?.id === 'browser_prepare:open_supported_browser' &&
        prepare.action?.browserRecovery?.ensuresReadableBlankTab === true &&
        prepare.action?.browserRecovery?.prepareEndpoint === '/api/browser/prepare' &&
        prepare.safety?.startsBrowser === false &&
        prepare.safety?.opensSafeBlankTab === false &&
        prepare.safety?.readsPageText === false &&
        prepare.safety?.executesPageJavaScript === false &&
        prepare.safety?.executesBrowserActions === false &&
        prepare.safety?.callsOpenAi === false &&
        prepare.safety?.asksWhichWindow === false
        ? ok('browser.prepare_preview', 'Browser prepare preview', 'preview exposes safe open/focus+blank-tab preparation without starting browser, reading page text, executing JS, or asking which window')
        : fail('browser.prepare_preview', 'Browser prepare preview', 'expected /api/browser/prepare preview to expose safe no-side-effect browser preparation contract', {
            status: preparePreview.status,
            body: preparePreview.data,
          }),
    );

    const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
    const packageSource = fs.readFileSync('package.json', 'utf8');
    const hasBrowserWorkNextRecovery =
      mainSource.includes('function browserUnavailableRecoveryAction') &&
      mainSource.includes('async function browserPrepareAction') &&
      mainSource.includes('function browserPreparedTargetSnapshot') &&
      mainSource.includes('function rememberBrowserReadiness') &&
      mainSource.includes('BROWSER_READINESS_READY_FRESH_MS') &&
      mainSource.includes('_browser_readiness_refresh') &&
      mainSource.includes('browser_recovery:retry_browser_work') &&
      mainSource.includes('browser_ready_retry') &&
      mainSource.includes('browser_window_unavailable') &&
      mainSource.includes("api.post('/api/browser/prepare'") &&
      mainSource.includes("'browser_prepare:open_supported_browser'") &&
      mainSource.includes("source: 'browser_recovery'") &&
      mainSource.includes("id: 'browser_recovery:open_supported_browser'") &&
      mainSource.includes("action.source === 'browser_recovery'") &&
      mainSource.includes('async function ensureBrowserRecoveryReadableTarget') &&
      mainSource.includes("safeBlankUrl: 'about:blank'") &&
      mainSource.includes('ensuresReadableBlankTab: true') &&
      mainSource.includes('make new window') &&
      mainSource.includes('readableTarget: recoveryResult.ensure') &&
      mainSource.includes('browserRecovery: action.browserRecovery') &&
      mainSource.includes('browserRecoveryFollowUpAction') &&
      mainSource.includes('readinessAfter: compactBrowserRecoveryReadiness') &&
      mainSource.includes('BROWSER_RECOVERY_AUTOPILOT_COOLDOWN_MS') &&
      mainSource.includes('eligible_browser_recovery') &&
      mainSource.includes("reason: 'browser_recovery_fresh'") &&
      mainSource.includes("appendAudit('browser_recovery.autopilot_attempted'") &&
      mainSource.includes('After execution, JAVIS will recheck browser readiness') &&
      packageSource.includes('"browser:prepare": "node scripts/config-cui.cjs --prepare-browser"');
    out.push(
      hasBrowserWorkNextRecovery
        ? ok('browser.work_next_recovery_wiring', 'Browser work-next recovery wiring', 'browser_window_unavailable routes can surface a cooldown-guarded autopilot browser recovery candidate')
        : fail('browser.work_next_recovery_wiring', 'Browser work-next recovery wiring', 'expected work-next to expose and execute cooldown-guarded browser_window_unavailable recovery through local action policy'),
    );

    const progress = await ctx.api('/api/work/progress?jobLimit=8&workflowLimit=8');
    const progressText = JSON.stringify(progress.data || {});
    const hasBrowserUnavailableBlocker = progressText.includes('browser_window_unavailable');
    const workNext = await ctx.api('/api/work/next?workflowLimit=8&jobLimit=8');
    const workNextActions = Array.isArray(workNext.data?.next?.briefing?.nextActions)
      ? workNext.data.next.briefing.nextActions
      : [];
    const browserRecoveryAction = workNextActions.find((action) => (
      action?.id === 'browser_recovery:open_supported_browser' ||
      action?.id === 'browser_recovery:retry_browser_work'
    ));
    const browserRecoveryIsOpen = browserRecoveryAction?.id === 'browser_recovery:open_supported_browser';
    const browserRecoveryIsRetry = browserRecoveryAction?.id === 'browser_recovery:retry_browser_work';
    out.push(
      hasBrowserUnavailableBlocker
        ? workNext.ok &&
          browserRecoveryAction?.source === 'browser_recovery' &&
          browserRecoveryAction?.executable === true &&
          browserRecoveryAction?.autoEligible === true &&
          browserRecoveryAction?.autopilotEligible === true &&
          (browserRecoveryIsOpen ? browserRecoveryAction?.startsApps === true : browserRecoveryAction?.startsApps === false) &&
          (browserRecoveryIsRetry ? browserRecoveryAction?.executesTask === true : browserRecoveryAction?.executesTask === false) &&
          browserRecoveryAction?.sendsMessages === false &&
          browserRecoveryAction?.mutatesUserFiles === false &&
          browserRecoveryAction?.mutatesUserRecords === false &&
          (browserRecoveryIsOpen ? browserRecoveryAction?.opensSafeBlankTab === true : browserRecoveryAction?.opensSafeBlankTab === false) &&
          browserRecoveryAction?.executesBrowserActions === false &&
          browserRecoveryAction?.readsPageText === false &&
          Number(browserRecoveryAction?.autopilotCooldownMs || 0) >= 60000 &&
          (browserRecoveryIsRetry || browserRecoveryAction?.macAction?.action === 'open_app') &&
          ['browser_window_unavailable', 'browser_ready_retry'].includes(browserRecoveryAction?.browserRecovery?.type) &&
          (browserRecoveryIsRetry || browserRecoveryAction?.browserRecovery?.safeBlankUrl === 'about:blank') &&
          (browserRecoveryIsRetry || browserRecoveryAction?.browserRecovery?.ensuresReadableBlankTab === true) &&
          (browserRecoveryIsOpen || browserRecoveryAction?.browserRecovery?.preparedTarget?.ready === true) &&
          Number(browserRecoveryAction?.browserRecovery?.autopilotCooldownMs || 0) >= 60000 &&
          String(browserRecoveryAction?.browserRecovery?.retryActionId || '').startsWith('route:') &&
          browserRecoveryAction?.browserRecovery?.readinessEndpoint === '/api/browser/readiness'
          ? ok('browser.work_next_recovery_runtime', 'Browser work-next recovery runtime', browserRecoveryIsRetry
              ? 'current browser_window_unavailable blocker now exposes retry-browser-work after browser target preparation'
              : 'current browser_window_unavailable blocker exposes autopilot-eligible open-supported-browser recovery with cooldown')
          : fail('browser.work_next_recovery_runtime', 'Browser work-next recovery runtime', 'expected current browser_window_unavailable blocker to produce a browser_recovery work-next action', {
              actions: workNextActions.slice(0, 6),
              progress: progress.data?.progress?.output || '',
            })
        : ok('browser.work_next_recovery_runtime', 'Browser work-next recovery runtime', 'no current browser_window_unavailable blocker to recover'),
    );

    const blockers = await ctx.api('/api/blockers');
    const progressPayload = progress.data?.progress || {};
    const blockerPayload = blockers.data?.blockers || {};
    const blockerItems = Array.isArray(blockerPayload.blockers) ? blockerPayload.blockers : [];
    const visibleBrowserUnavailableWorkflows = Array.isArray(progressPayload.blockedWorkflows)
      ? progressPayload.blockedWorkflows.filter((workflow) => /browser_window_unavailable|browser_context_unavailable|browser target unavailable|browser context unavailable|no supported browser/i.test([
        workflow.result,
        workflow.request,
        workflow.title,
        workflow.target?.error,
      ].filter(Boolean).join('\n')))
      : [];
    const blockedWorkflowItem = blockerItems.find((item) => item.id === 'blocked_workflows') || null;
    out.push(
      browserRecoveryAction
        ? blockers.ok &&
          mainSource.includes('function isBrowserUnavailableWorkflowBlocker') &&
          mainSource.includes('browserRecovery && isBrowserUnavailableWorkflowBlocker(workflow)') &&
          visibleBrowserUnavailableWorkflows.length === 0 &&
          !(blockedWorkflowItem && Number(progressPayload.counts?.blockedWorkflows || 0) === 0)
          ? ok('browser.recovery_folds_workflow_noise', 'Browser recovery folds workflow noise', 'browser_window_unavailable workflows are folded into browser_recovery instead of duplicate blocked_workflows noise')
          : fail('browser.recovery_folds_workflow_noise', 'Browser recovery folds workflow noise', 'expected browser recovery to hide duplicate browser_window_unavailable workflow blockers from progress/blockers', {
              blockerItems: blockerItems.slice(0, 5),
              blockedWorkflows: progressPayload.blockedWorkflows,
            })
        : ok('browser.recovery_folds_workflow_noise', 'Browser recovery folds workflow noise', 'no current browser recovery action to fold'),
    );

    const javascript = await ctx.api('/api/browser/javascript');
    const js = javascript.data?.javascript;
    out.push(
      javascript.ok && js
        ? ok('browser.javascript', 'Browser JavaScript bridge', `${js.enabled ? 'enabled' : 'not enabled'}${js.bridge ? ` via ${js.bridge}` : ''}`, { supported: js.supported, available: js.available, enabled: js.enabled })
        : warn('browser.javascript', 'Browser JavaScript bridge', `GET /api/browser/javascript ${javascript.status} ${javascript.error || ''}`),
    );

    const dom = await ctx.api('/api/browser/dom?limit=5', { timeoutMs: 15000 });
    const d = dom.data?.dom;
    out.push(
      dom.ok && d
        ? ok('browser.dom', 'Browser DOM snapshot', d.available ? `${(d.controls || d.elements || []).length} visible control(s)` : 'DOM snapshot unavailable for current app/tab', { available: d.available })
        : warn('browser.dom', 'Browser DOM snapshot', `GET /api/browser/dom ${dom.status} ${dom.error || ''}`),
    );

    const fixturePage = {
      available: true,
      supported: true,
      app: 'FixtureBrowser',
      title: 'Signup Form',
      url: 'https://example.test/signup',
      text: 'Name Email Plan',
    };
    const fixtureDom = {
      available: true,
      supported: true,
      app: 'FixtureBrowser',
      title: 'Signup Form',
      url: 'https://example.test/signup',
      elements: [
        { id: '1', selector: '#name', tag: 'input', type: 'text', label: 'Name', placeholder: 'Full name', name: 'name', disabled: false },
        { id: '2', selector: '#email', tag: 'input', type: 'email', label: 'Email', placeholder: 'Email address', name: 'email', disabled: false },
        { id: '3', selector: '#plan', tag: 'select', type: '', label: 'Plan', placeholder: '', name: 'plan', disabled: false },
        { id: '4', selector: '#password', tag: 'input', type: 'password', label: 'Password', placeholder: 'Password', name: 'password', disabled: false },
        { id: 'submit', selector: '#submit', tag: 'button', type: 'submit', label: 'Submit', text: 'Create account', name: '', disabled: false },
      ],
    };

    const fillDraft = await ctx.api('/api/browser/fill-draft', {
      method: 'POST',
      body: {
        page: fixturePage,
        dom: fixtureDom,
        fields: {
          Name: 'Haoge',
          Email: 'haoge@example.com',
          Plan: 'Pro',
          Password: 'secret-password',
        },
        execute: false,
        source: 'eval_browser_fill_draft',
      },
    });
    out.push(
      fillDraft.ok &&
        fillDraft.data?.intent === 'fill_draft' &&
        fillDraft.data?.executed === false &&
        fillDraft.data?.plan?.steps?.length === 3 &&
        fillDraft.data?.plan?.blocked?.length === 1 &&
        fillDraft.data?.plan?.steps?.every((step) => !String(step.value || '').includes('haoge@example.com')) &&
        !JSON.stringify(fillDraft.data?.fields || []).includes('secret-password') &&
        fillDraft.data?.fields?.find((field) => field.name === 'Password')?.valuePreview === '[sensitive]' &&
        fillDraft.data?.verification?.status === 'preview_only' &&
        fillDraft.data?.verification?.entries?.length === 3 &&
        !JSON.stringify(fillDraft.data?.results || {}).includes('haoge@example.com') &&
        !JSON.stringify(fillDraft.data?.results || {}).includes('secret-password') &&
        !JSON.stringify(fillDraft.data?.verification || {}).includes('haoge@example.com') &&
        !JSON.stringify(fillDraft.data?.recovery || {}).includes('haoge@example.com') &&
        fillDraft.data?.workflow?.target?.fillDraft?.version === 1 &&
        fillDraft.data?.workflow?.target?.fillDraft?.blocked?.find((field) => field.field === 'Password')?.requiresSensitiveValue === true &&
        !JSON.stringify(fillDraft.data?.workflow?.target?.fillDraft || {}).includes('secret-password') &&
        fillDraft.data?.results?.every((result) => result.status === 'previewed')
        ? ok('browser.fill_draft_preview', 'Browser fill draft preview', '3 field fill draft(s), 1 sensitive field blocked')
        : fail('browser.fill_draft_preview', 'Browser fill draft preview', `POST /api/browser/fill-draft ${fillDraft.status}`, fillDraft.data),
    );

    const fillRouteId = fillDraft.data?.routing?.id || '';
    const fillRouteRecovery = fillRouteId
      ? await ctx.api(`/api/tasks/routing/${encodeURIComponent(fillRouteId)}/recovery?source=eval_browser_fill_recovery`)
      : null;
    const fillRecovery = fillRouteRecovery?.data?.recovery || {};
    const fillRecommended = fillRecovery.recommended || {};
    const fillHandoff = fillRecommended.browserFillRecovery || {};
    const fillRecoveryBody = JSON.stringify(fillRouteRecovery?.data || {});
    out.push(
      fillDraft.ok &&
        fillRouteRecovery?.ok &&
        fillRecommended.type === 'browser_fill_sensitive_handoff' &&
        fillRecommended.executable === true &&
        fillHandoff.version === 1 &&
        fillHandoff.status === 'needs_user_sensitive_handoff' &&
        fillHandoff.safePreparedCount === 3 &&
        fillHandoff.blocked?.some((field) => field.field === 'Password' && field.requiresSensitiveValue === true) &&
        fillHandoff.previewable?.some((action) => action.readOnly === true && action.storesSensitiveValue === false) &&
        fillHandoff.manual?.some((action) => action.type === 'manual_sensitive_field' && action.field === 'Password' && action.storesSensitiveValue === false) &&
        fillHandoff.boundaries?.some((item) => /Do not store password/i.test(item)) &&
        !fillRecoveryBody.includes('secret-password') &&
        !fillRecoveryBody.includes('haoge@example.com')
        ? ok('browser.fill_draft_route_recovery', 'Browser fill draft route recovery', 'sensitive field produces a safe handoff plan')
        : fail('browser.fill_draft_route_recovery', 'Browser fill draft route recovery', 'expected routed fill draft recovery to recommend sensitive-field handoff without leaking values', fillRouteRecovery?.data),
    );

    const domActionPreview = await ctx.api('/api/browser/dom-action', {
      method: 'POST',
      body: {
        action: 'click',
        selector: '#submit',
        execute: false,
        source: 'eval_browser_dom_action_contract',
      },
    });
    out.push(
      domActionPreview.ok &&
        domActionPreview.data?.executed === false &&
        domActionPreview.data?.safety?.preflightReobserve === true &&
        domActionPreview.data?.safety?.reobserveTiming === 'before_execute' &&
        domActionPreview.data?.safety?.formSubmissionDefault === 'approval_required' &&
        domActionPreview.data?.safety?.executesFormSubmitByDefault === false &&
        domActionPreview.data?.plan?.metadata?.reobserveBeforeExecute === true &&
        domActionPreview.data?.plan?.metadata?.noFormSubmitByDefault === true &&
        domActionPreview.data?.plan?.metadata?.submitLikeRiskLevel === 4
        ? ok('browser.dom_action_preview_contract', 'Browser DOM action preview contract', 'preview declares DOM re-observe and no-submit default')
        : fail('browser.dom_action_preview_contract', 'Browser DOM action preview contract', `POST /api/browser/dom-action ${domActionPreview.status}`, domActionPreview.data),
    );

    const domActionExecuteGate = await ctx.api('/api/browser/dom-action', {
      method: 'POST',
      body: {
        action: 'click',
        selector: '#submit',
        execute: true,
        dom: fixtureDom,
        source: 'eval_browser_dom_action_execute_gate',
      },
    });
    out.push(
      domActionExecuteGate.ok &&
        domActionExecuteGate.data?.executed === false &&
        domActionExecuteGate.data?.fixture === true &&
        domActionExecuteGate.data?.preflight?.fixture === true &&
        domActionExecuteGate.data?.preflight?.submitLike === true &&
        domActionExecuteGate.data?.preflight?.bridge === 'fixture' &&
        domActionExecuteGate.data?.plan?.riskLevel === 4 &&
        domActionExecuteGate.data?.plan?.metadata?.submitLikePreflight === true &&
        domActionExecuteGate.data?.evaluation?.needsApproval === true &&
        domActionExecuteGate.data?.confirmationRequired === true &&
        domActionExecuteGate.data?.gate?.status === 'approval_required' &&
        domActionExecuteGate.data?.gate?.browserAction === false &&
        domActionExecuteGate.data?.gate?.formSubmitted === false &&
        domActionExecuteGate.data?.safety?.fixtureExecutionBlocked === true &&
        domActionExecuteGate.data?.safety?.executesFormSubmitByDefault === false
        ? ok('browser.dom_action_execute_gate_fixture', 'Browser DOM action execute gate fixture', 'submit-like fixture target re-observed and stopped at confirmation gate')
        : fail('browser.dom_action_execute_gate_fixture', 'Browser DOM action execute gate fixture', `POST /api/browser/dom-action ${domActionExecuteGate.status}`, domActionExecuteGate.data),
    );

    const domActionConfirmedFixture = await ctx.api('/api/browser/dom-action', {
      method: 'POST',
      body: {
        action: 'click',
        selector: '#submit',
        execute: true,
        confirm: true,
        dom: fixtureDom,
        source: 'eval_browser_dom_action_confirmed_fixture',
      },
    });
    out.push(
      domActionConfirmedFixture.ok &&
        domActionConfirmedFixture.data?.executed === false &&
        domActionConfirmedFixture.data?.fixture === true &&
        domActionConfirmedFixture.data?.preflight?.submitLike === true &&
        domActionConfirmedFixture.data?.plan?.riskLevel === 4 &&
        domActionConfirmedFixture.data?.evaluation?.needsApproval === false &&
        domActionConfirmedFixture.data?.confirmationRequired === false &&
        domActionConfirmedFixture.data?.gate?.status === 'fixture_preview_only' &&
        domActionConfirmedFixture.data?.gate?.approvedRequested === true &&
        domActionConfirmedFixture.data?.gate?.browserAction === false &&
        domActionConfirmedFixture.data?.gate?.formSubmitted === false &&
        domActionConfirmedFixture.data?.safety?.approvedRequested === true &&
        domActionConfirmedFixture.data?.safety?.fixtureExecutionBlocked === true &&
        domActionConfirmedFixture.data?.safety?.executesFormSubmitByDefault === false
        ? ok('browser.dom_action_confirmed_fixture_gate', 'Browser DOM action confirmed fixture gate', 'confirm:true is recognized but fixture DOM still cannot execute browser actions')
        : fail('browser.dom_action_confirmed_fixture_gate', 'Browser DOM action confirmed fixture gate', `POST /api/browser/dom-action ${domActionConfirmedFixture.status}`, domActionConfirmedFixture.data),
    );

    const fixtureExecute = await ctx.api('/api/browser/fill-draft', {
      method: 'POST',
      body: {
        page: fixturePage,
        dom: fixtureDom,
        fields: { Email: 'haoge@example.com' },
        execute: true,
        confirm: true,
        source: 'eval_browser_fill_draft_fixture',
      },
    });
    out.push(
      fixtureExecute.ok &&
        fixtureExecute.data?.executed === false &&
        fixtureExecute.data?.verification?.status === 'fixture_blocked' &&
        fixtureExecute.data?.recovery?.status === 'fixture_preview_only' &&
        fixtureExecute.data?.recovery?.actions?.some((action) => action.type === 'rerun_on_live_browser') &&
        !JSON.stringify(fixtureExecute.data?.recovery || {}).includes('haoge@example.com') &&
        fixtureExecute.data?.results?.[0]?.status === 'blocked' &&
        /fixture/i.test(String(fixtureExecute.data?.output || ''))
        ? ok('browser.fill_draft_fixture_gate', 'Browser fill draft fixture gate', 'fixture DOM cannot execute browser fills')
        : fail('browser.fill_draft_fixture_gate', 'Browser fill draft fixture gate', `POST /api/browser/fill-draft ${fixtureExecute.status}`, fixtureExecute.data),
    );

    const workflowFixturePage = {
      available: true,
      supported: true,
      app: 'FixtureBrowser',
      title: 'JAVIS Launch Notes',
      url: 'https://example.test/javis-launch',
      metaDescription: 'Internal launch checklist for a browser-enabled local agent.',
      headings: ['Launch Plan', 'Follow-up Actions'],
      text: [
        'JAVIS launch checklist.',
        'Owner: resident browser lane.',
        'Action: verify live browser fill dogfood before broadening browser automation.',
        'Action: keep the desktop pet quiet while workflow logs stay in CUI.',
        'Deadline: Friday.',
        'Private fixture token: sk-test-secret-do-not-return.',
      ].join('\n'),
      links: [
        { text: 'Operator runbook', href: 'https://example.test/runbook' },
      ],
    };
    const workflowPreview = await ctx.api('/api/browser/workflow', {
      method: 'POST',
      body: {
        intent: 'extract_actions',
        mode: 'quick',
        execute: false,
        instruction: 'Extract follow-up actions from this page.',
        page: workflowFixturePage,
      },
    });
    const workflowPreviewBody = JSON.stringify(workflowPreview.data || {});
    out.push(
      workflowPreview.ok &&
        workflowPreview.data?.ok === true &&
        workflowPreview.data?.preview === true &&
        workflowPreview.data?.executed === false &&
        workflowPreview.data?.queued === false &&
        workflowPreview.data?.intent === 'extract_actions' &&
        workflowPreview.data?.workflow?.status === 'done' &&
        workflowPreview.data?.routing?.status === 'done' &&
        workflowPreview.data?.page?.title === 'JAVIS Launch Notes' &&
        workflowPreview.data?.page?.returnedLength > 100 &&
        workflowPreview.data?.page?.linkCount === 1 &&
        /Preview only/.test(String(workflowPreview.data?.output || '')) &&
        !workflowPreviewBody.includes('sk-test-secret-do-not-return')
        ? ok('browser.workflow_preview_fixture', 'Browser workflow preview fixture', 'previewed extract_actions without model call, queue, or page-text echo')
        : fail('browser.workflow_preview_fixture', 'Browser workflow preview fixture', `POST /api/browser/workflow ${workflowPreview.status}`, workflowPreview.data),
    );

    const researchPreview = await ctx.api('/api/browser/workflow', {
      method: 'POST',
      body: {
        intent: 'research',
        mode: 'quick',
        execute: false,
        source: 'eval_browser_research_continuation',
        scope: 'eval:browser:research',
        instruction: 'Research two JAVIS browser automation references.',
        urls: [
          'https://example.test/javis/browser-a',
          'https://example.test/javis/browser-b',
        ],
        maxPages: 2,
      },
    });
    out.push(
      researchPreview.ok &&
        researchPreview.data?.ok === true &&
        researchPreview.data?.executed === false &&
        researchPreview.data?.intent === 'research' &&
        researchPreview.data?.selectedLinks?.length === 2 &&
        researchPreview.data?.continuation?.status === 'preview' &&
        researchPreview.data?.continuation?.selectedLinks?.length === 2 &&
        researchPreview.data?.continuation?.summary?.includes('2 page') &&
        researchPreview.data?.workflow?.continuation?.status === 'preview' &&
        researchPreview.data?.workflow?.continuation?.selectedLinks?.length === 2 &&
        researchPreview.data?.workflow?.target?.resultCount === 2 &&
        researchPreview.data?.routing?.status === 'done' &&
        !JSON.stringify(researchPreview.data || {}).includes('Private fixture token')
        ? ok('browser.research_continuation_preview', 'Browser research continuation preview', 'preview persists selected links plus structured continuation metadata')
        : fail('browser.research_continuation_preview', 'Browser research continuation preview', `POST /api/browser/workflow ${researchPreview.status}`, researchPreview.data),
    );

    const benchmarks = await ctx.api('/api/browser/benchmarks?source=eval_browser_benchmark');
    const bench = benchmarks.data?.benchmarks;
    const caseIds = new Set((Array.isArray(bench?.cases) ? bench.cases : []).map((item) => item.id));
    out.push(
      benchmarks.ok &&
        bench?.ok === true &&
        bench?.previewOnly === true &&
        bench?.startsBrowser === false &&
        bench?.executesBrowserActions === false &&
        bench?.modelCalls === false &&
        bench?.storesRawPageText === false &&
        bench?.counts?.total >= 9 &&
        bench?.counts?.pass === bench.counts.total &&
        bench?.counts?.fail === 0 &&
        bench?.safety?.noBrowserActions === true &&
        bench?.safety?.noModelCalls === true &&
        bench?.safety?.noSecretEcho === true &&
        bench?.safety?.domReobserveBeforeAction === true &&
        bench?.safety?.domSubmitExecuteGate === true &&
        bench?.safety?.domConfirmFixtureNoExecute === true &&
        bench?.safety?.noFormSubmitByDefault === true &&
        bench?.safety?.sensitiveFieldsBlocked === true &&
        ['extract_actions_fixture', 'summarize_fixture', 'fill_draft_fixture', 'dom_action_contract_fixture', 'dom_action_execute_gate_fixture', 'dom_action_confirmed_fixture_gate', 'research_continuation_fixture', 'compare_preview_fixture', 'review_result_preview_fixture'].every((id) => caseIds.has(id)) &&
        bench.cases.every((item) => item.ok === true && item.modelCall === false && item.browserAction === false)
        ? ok('browser.workflow_benchmarks', 'Browser workflow benchmarks', `${bench.counts.pass}/${bench.counts.total} preview fixture(s) passed`)
        : fail('browser.workflow_benchmarks', 'Browser workflow benchmarks', `GET /api/browser/benchmarks ${benchmarks.status}`, benchmarks.data),
    );

    try {
      const cuiReady = await execFileAsync('npm', ['run', 'browser:ready'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cuiReady.stdout || ''}\n${cuiReady.stderr || ''}`;
      out.push(
        output.includes('JAVIS Browser Readiness') &&
          output.includes('Default target:') &&
          output.includes('asks window=no') &&
          output.includes('read-only=yes') &&
          output.includes('executes JS=no') &&
          output.includes('readiness: npm run browser:ready')
          ? ok('browser.cui_readiness', 'Browser CUI readiness', 'npm run browser:ready prints default target, capabilities, commands, and safety')
          : fail('browser.cui_readiness', 'Browser CUI readiness', 'expected CUI readiness output to print no-window-picker safety and commands', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('browser.cui_readiness', 'Browser CUI readiness', error instanceof Error ? error.message : String(error)));
    }

    try {
      const cuiBench = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-browser-benchmarks'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cuiBench.stdout || ''}\n${cuiBench.stderr || ''}`;
      out.push(
        output.includes('Browser Workflow Benchmarks') &&
          output.includes('preview-only=yes') &&
          output.includes('starts browser=no') &&
          output.includes('model calls=no') &&
          output.includes('sensitive fields blocked=yes') &&
          output.includes('submit execute gate=yes') &&
          output.includes('confirmed fixture gate=yes') &&
          output.includes('DOM action execute gate fixture') &&
          output.includes('DOM action confirmed fixture gate') &&
          output.includes('Research continuation fixture')
          ? ok('browser.cui_workflow_benchmarks', 'Browser CUI workflow benchmarks', 'config CUI prints preview-only benchmark status')
          : fail('browser.cui_workflow_benchmarks', 'Browser CUI workflow benchmarks', 'expected CUI benchmark output to print preview-only safety and benchmark cases', { output: output.slice(0, 2400) }),
      );
    } catch (error) {
      out.push(fail('browser.cui_workflow_benchmarks', 'Browser CUI workflow benchmarks', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
