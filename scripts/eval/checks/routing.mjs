import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ok, warn, fail } from '../_client.mjs';

const USER_SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills');

function writeEvalRoutingSkill() {
  const name = `eval-routing-skill-${Date.now().toString(36)}`;
  const dir = path.join(USER_SKILLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'description: Restore target panel saved state with an audited replay plan.',
    '---',
    '',
    '# Purpose',
    'Use this skill when a task mentions target panel saved state and needs a previewed plan before any action.',
    '',
    '# Triggers',
    'target panel saved state',
    '',
    '# Workflow',
    '1. Observe the current target panel instead of replaying old coordinates.',
    '2. Compare current state with the saved state the user wants restored.',
    '3. Produce a preview-only recovery plan with evidence before execution.',
    '',
    '# Replay Plan',
    'Use current Accessibility or DOM refs, require explicit confirmation, and keep the replay in preview mode unless confirmed.',
    '',
    '# Evidence Snapshot',
    'Demonstration id: eval-routing-demo',
    'Source: explicit UI demonstration',
    '',
  ].join('\n'), 'utf8');
  return { name, dir };
}

function cleanupEvalRoutingSkill(skill) {
  const root = path.resolve(USER_SKILLS_DIR);
  const dir = path.resolve(skill?.dir || '');
  if (dir.startsWith(`${root}${path.sep}`) && path.basename(dir).startsWith('eval-routing-skill-')) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  lane: 'routing',
  async run(ctx) {
    const out = [];

    const contracts = await ctx.api('/api/lanes/contracts');
    const lc = contracts.data?.laneContracts;
    const count = lc?.count || lc?.contracts?.length || lc?.ids?.length || 0;
    out.push(
      contracts.ok && count >= 4
        ? ok('routing.contracts', 'Lane contracts', `${count} lane contract(s) exposed`)
        : fail('routing.contracts', 'Lane contracts', `contracts ${contracts.status} ${contracts.error || ''}`, lc),
    );

    const quick = await ctx.api('/api/tasks/route', {
      method: 'POST',
      body: { message: '现在状态怎么样？', execute: false, useMemory: false, source: 'eval' },
    });
    const quickDecision = quick.data?.decision;
    out.push(
      quick.ok && quickDecision?.lane
        ? ok('routing.preview', 'Task route preview', `${quickDecision.lane} · ${quickDecision.reason || 'routed'}`)
        : fail('routing.preview', 'Task route preview', `route ${quick.status} ${quick.error || quick.data?.error || ''}`, quick.data),
    );

    const parallel = await ctx.api('/api/tasks/parallel', {
      method: 'POST',
      body: {
        execute: false,
        parallelGroup: `eval-routing-${Date.now()}`,
        tasks: [
          { task: 'Update eval routing fixture A', mode: 'codex', owner: 'eval-a', scope: 'eval/routing-conflict.md', access: 'write' },
          { task: 'Update eval routing fixture B', mode: 'claude', owner: 'eval-b', scope: 'eval/routing-conflict.md', access: 'write' },
        ],
      },
    });
    const second = parallel.data?.results?.[1];
    out.push(
      parallel.ok && parallel.data?.ownership?.conflicts >= 1 && second?.ownership?.serialized === true
        ? ok('routing.parallel_guard', 'Parallel ownership guard', 'overlapping write scopes serialized')
        : fail('routing.parallel_guard', 'Parallel ownership guard', `expected serialized conflict, got ${parallel.status}`, parallel.data),
    );

    const ledger = await ctx.api('/api/tasks/routing?limit=5');
    out.push(
      ledger.ok && Array.isArray(ledger.data?.records)
        ? ok('routing.ledger', 'Routing ledger', `${ledger.data.records.length} recent route record(s) · ${ledger.data.counts?.total || 0} total`)
        : warn('routing.ledger', 'Routing ledger', `ledger ${ledger.status} ${ledger.error || ''}`),
    );

    let evalSkill = null;
    let evalWorkerJobId = '';
    let evalShortcutId = '';
    try {
      evalSkill = writeEvalRoutingSkill();
      const routedWithSkill = await ctx.api('/api/tasks/route', {
        method: 'POST',
        body: {
          message: `Prepare the target panel saved state workflow with ${evalSkill.name}; preview only.`,
          execute: false,
          useMemory: true,
          source: 'eval_skill_plan',
          skillLimit: 5,
        },
      });
      const skillPlan = routedWithSkill.data?.skillRecallPlan;
      const recordPlan = routedWithSkill.data?.routing?.skillRecallPlan;
      const tools = routedWithSkill.data?.contextPlan?.recommendedTools || [];
      const matchedName = skillPlan?.primarySkill?.name || recordPlan?.primarySkill?.name || '';
      out.push(
        routedWithSkill.ok
          && skillPlan?.applied === true
          && recordPlan?.applied === true
          && matchedName === evalSkill.name
          && tools.includes('search_local_skills')
          ? ok('routing.local_skill_plan', 'Local skill plan in routing', `${evalSkill.name} changed route plan with ${tools.length} tool hint(s)`)
          : fail('routing.local_skill_plan', 'Local skill plan in routing', 'expected recalled local skill plan in preview route and ledger record', routedWithSkill.data),
      );

      const shortcutPhrase = `eval shortcut ${Date.now().toString(36)}`;
      const shortcutPreview = await ctx.api('/api/shortcuts/promote', {
        method: 'POST',
        body: {
          source: 'eval_shortcut',
          phrase: shortcutPhrase,
          skillRecallPlan: skillPlan,
        },
        retries: 0,
      });
      out.push(
        shortcutPreview.status === 409
          && shortcutPreview.data?.requiresConfirmation === true
          && shortcutPreview.data?.shortcut?.phrase === shortcutPhrase
          ? ok('routing.shortcut_confirmation_gate', 'Shortcut promotion confirmation gate', 'shortcut save requires explicit confirmation')
          : fail('routing.shortcut_confirmation_gate', 'Shortcut promotion confirmation gate', 'expected unconfirmed shortcut promotion to return 409 confirmation gate', shortcutPreview.data),
      );

      const shortcutSaved = await ctx.api('/api/shortcuts/promote', {
        method: 'POST',
        body: {
          source: 'eval_shortcut',
          confirm: true,
          phrase: shortcutPhrase,
          skillRecallPlan: skillPlan,
        },
        retries: 0,
      });
      evalShortcutId = shortcutSaved.data?.shortcut?.id || '';
      const shortcutRoute = await ctx.api('/api/tasks/route', {
        method: 'POST',
        body: {
          message: `${shortcutPhrase} for target panel saved state`,
          execute: false,
          useMemory: false,
          source: 'eval_shortcut_route',
        },
      });
      const shortcutPlan = shortcutRoute.data?.skillRecallPlan;
      const shortcutTools = shortcutRoute.data?.contextPlan?.recommendedTools || [];
      out.push(
        shortcutSaved.ok
          && evalShortcutId
          && shortcutRoute.ok
          && shortcutRoute.data?.shortcut?.phrase === shortcutPhrase
          && shortcutPlan?.decisionEffect === 'shortcut_phrase_matched'
          && shortcutPlan?.primarySkill?.name === evalSkill.name
          && shortcutTools.includes('search_local_skills')
          ? ok('routing.shortcut_recall', 'Shortcut phrase recalls skill plan', `${shortcutPhrase} recalled ${evalSkill.name} without memory search`)
          : fail('routing.shortcut_recall', 'Shortcut phrase recalls skill plan', 'expected saved shortcut to recall skill plan with useMemory:false', { shortcutSaved: shortcutSaved.data, shortcutRoute: shortcutRoute.data }),
      );

      const routedWorker = await ctx.api('/api/tasks/route', {
        method: 'POST',
        body: {
          message: `Prepare the target panel saved state workflow with ${evalSkill.name}; start worker but do not mutate anything.`,
          execute: true,
          mode: 'background',
          useMemory: true,
          source: 'eval_skill_worker',
          skillLimit: 5,
          timeoutMs: 60000,
        },
      });
      evalWorkerJobId = routedWorker.data?.job?.id || '';
      let observedJob = routedWorker.data?.job || null;
      if (evalWorkerJobId) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const jobResponse = await ctx.api(`/api/jobs/${encodeURIComponent(evalWorkerJobId)}`);
          observedJob = jobResponse.data?.job || observedJob;
          if (/Using recalled skill plan/.test(String(observedJob?.log || ''))) break;
          if (observedJob && !['queued', 'running'].includes(observedJob.status)) break;
          await sleep(250);
        }
      }
      const jobPlan = observedJob?.skillRecallPlan || routedWorker.data?.job?.skillRecallPlan;
      const jobUsedPlan = /Using recalled skill plan/.test(String(observedJob?.log || ''));
      out.push(
        routedWorker.ok
          && evalWorkerJobId
          && jobPlan?.applied === true
          && jobPlan?.primarySkill?.name === evalSkill.name
          && jobUsedPlan
          ? ok('routing.local_skill_worker', 'Local skill plan reaches worker', `${evalSkill.name} attached to job ${evalWorkerJobId}`)
          : fail('routing.local_skill_worker', 'Local skill plan reaches worker', 'expected queued worker job to persist and log recalled skill plan use', { routedWorker: routedWorker.data, observedJob }),
      );
    } catch (error) {
      out.push(fail('routing.local_skill_plan', 'Local skill plan in routing', error instanceof Error ? error.message : String(error)));
    } finally {
      if (evalWorkerJobId) {
        await ctx.api(`/api/jobs/${encodeURIComponent(evalWorkerJobId)}/cancel`, {
          method: 'POST',
          body: { reason: 'eval skill worker check complete' },
          retries: 0,
        });
      }
      if (evalShortcutId) {
        await ctx.api(`/api/shortcuts/${encodeURIComponent(evalShortcutId)}?source=eval_cleanup`, {
          method: 'DELETE',
          retries: 0,
        });
      }
      cleanupEvalRoutingSkill(evalSkill);
    }

    const briefing = await ctx.api('/api/briefing');
    const routeActions = (briefing.data?.briefing?.nextActions || []).filter((action) => action.source === 'routing');
    let internalRouteAction = null;
    for (const action of routeActions) {
      const route = action.routeId ? await ctx.api(`/api/tasks/routing/${encodeURIComponent(action.routeId)}`) : null;
      const source = String(route?.data?.record?.source || '').toLowerCase();
      if (source === 'eval' || source === 'doctor' || source.startsWith('eval_')) {
        internalRouteAction = { action, route: route?.data?.record };
        break;
      }
    }
    out.push(
      briefing.ok && !internalRouteAction
        ? ok('routing.internal_hidden', 'Internal routes hidden from Work Next', routeActions.length ? `${routeActions.length} user route action(s) visible` : 'no routing action currently visible')
        : fail('routing.internal_hidden', 'Internal routes hidden from Work Next', 'eval/doctor route appeared in briefing next actions', internalRouteAction),
    );

    return out;
  },
};
