import { ok, warn, fail } from '../_client.mjs';

// Workflow history (README: "Workflow history for recent browser, voice, and
// background work" + continue-from-history). Read-only — lists history and
// previews continuation context; does not continue or copy a workflow.
export default {
  lane: 'workflows',
  async run(ctx) {
    const out = [];

    const list = await ctx.api('/api/workflows?limit=5');
    const workflows = list.data?.workflows;
    if (!list.ok || !Array.isArray(workflows)) {
      out.push(fail('workflows.history', 'Workflow history', `GET /api/workflows ${list.status} ${list.error || ''}`));
      return out;
    }
    const counts = list.data?.counts || {};
    out.push(ok('workflows.history', 'Workflow history', `${workflows.length} recent · ${counts.total ?? workflows.length} total · ${counts.done ?? '?'} done`, { counts }));

    const sample = workflows[0];
    const hasContract = sample && 'id' in sample && 'status' in sample && ('kind' in sample || 'intent' in sample);
    out.push(
      sample
        ? (hasContract
          ? ok('workflows.records', 'Workflow records', `linked records carry id/status/kind (latest: ${sample.status} ${sample.kind || sample.intent || ''})`)
          : warn('workflows.records', 'Workflow records', `record missing id/status/kind (${Object.keys(sample).slice(0, 8).join(',')})`))
        : warn('workflows.records', 'Workflow records', 'no workflows yet to inspect'),
    );

    if (sample?.id) {
      const preview = await ctx.api(`/api/workflows/${encodeURIComponent(sample.id)}/continue`, {
        method: 'POST',
        body: {
          preview: true,
          execute: false,
          instruction: 'Summarize the next concrete follow-up step.',
          mode: 'background',
          workflowLimit: 3,
        },
      });
      const continuation = preview.data?.continuation || {};
      const memory = continuation.memory || {};
      const prompt = String(preview.data?.prompt || '');
      out.push(
        preview.ok &&
          preview.data?.preview === true &&
          preview.data?.queued === false &&
          prompt.includes('Previous workflow:') &&
          prompt.includes('Memory and learned user context for this continuation:') &&
          prompt.includes('Evolution summary:') &&
          Array.isArray(continuation.relatedWorkflows) &&
          typeof memory.count === 'number' &&
          memory.learningEvidence?.usedInPrompt === true &&
          memory.learningEvidence?.evolution?.attached === true &&
          typeof memory.learningEvidence?.evolution?.changeCount === 'number'
          ? ok('workflows.continuation_preview', 'Memory-aware continuation preview', `${memory.count} memory match(es), ${continuation.relatedWorkflows.length} related workflow(s), evolution ${memory.learningEvidence.evolution.changeCount} change(s)`)
          : fail('workflows.continuation_preview', 'Memory-aware continuation preview', 'continuation preview did not expose memory-aware prompt context without queueing work', preview.data),
      );
    }

    const browserResearchPreview = await ctx.api('/api/browser/workflow', {
      method: 'POST',
      body: {
        intent: 'research',
        mode: 'quick',
        execute: false,
        instruction: 'Research two JAVIS browser handoff references.',
        urls: [
          'https://example.test/javis/workflow-a',
          'https://example.test/javis/workflow-b',
        ],
        maxPages: 2,
      },
    });
    const browserWorkflowId = browserResearchPreview.data?.workflow?.id || '';
    out.push(
      browserResearchPreview.ok &&
        browserResearchPreview.data?.ok === true &&
        browserResearchPreview.data?.executed === false &&
        browserResearchPreview.data?.workflow?.continuation?.nextActions?.length >= 1
        ? ok('workflows.browser_research_seed', 'Browser research follow-up seed', `${browserWorkflowId} has persisted continuation action(s)`)
        : fail('workflows.browser_research_seed', 'Browser research follow-up seed', 'browser research preview did not persist a continuation action', browserResearchPreview.data),
    );

    const followUpResponse = await ctx.api('/api/workflows/follow-ups?limit=5');
    const followUps = followUpResponse.data?.followUps;
    out.push(
      followUpResponse.ok && Array.isArray(followUps)
        ? ok('workflows.followups', 'Workflow follow-up suggestions', `${followUps.length} suggestion(s)`)
        : fail('workflows.followups', 'Workflow follow-up suggestions', `GET /api/workflows/follow-ups ${followUpResponse.status} ${followUpResponse.error || ''}`, followUpResponse.data),
    );
    const followUp = Array.isArray(followUps) ? followUps[0] : null;
    if (followUp) {
      const shapeOk = Boolean(
        followUp.source === 'workflows' &&
        followUp.workflowAction === 'continue' &&
        followUp.id &&
        followUp.workflowId &&
        followUp.instruction &&
        followUp.continuation &&
        typeof followUp.continuation.memoryMatches === 'number' &&
        typeof followUp.continuation.skillMatches === 'number' &&
        typeof followUp.continuation.relatedWorkflows === 'number' &&
        followUp.continuation.learningEvidence?.evolution &&
        typeof followUp.continuation.learningEvidence.evolution.changeCount === 'number'
      );
      out.push(
        shapeOk
          ? ok('workflows.followups_shape', 'Workflow follow-up shape', `${followUp.id} -> ${followUp.workflowId}`)
          : fail('workflows.followups_shape', 'Workflow follow-up shape', 'suggestion did not include continuation metadata', followUp),
      );

      const workNext = await ctx.api(`/api/work/next?actionId=${encodeURIComponent(followUp.id)}`);
      const next = workNext.data?.next || {};
      out.push(
        workNext.ok &&
          next.ok === true &&
          next.executed === false &&
          next.action?.id === followUp.id &&
          next.result?.preview === true &&
          String(next.output || '').includes('Preview continuation')
          ? ok('workflows.followups_worknext', 'Workflow follow-up work-next preview', String(next.output).slice(0, 140))
          : fail('workflows.followups_worknext', 'Workflow follow-up work-next preview', 'work-next did not preview the selected follow-up without execution', workNext.data),
      );
    }

    const browserFollowUp = Array.isArray(followUps)
      ? followUps.find((item) => item.workflowId === browserWorkflowId)
      : null;
    const browserBody = browserFollowUp?.browserWorkflow?.body || {};
    out.push(
      browserFollowUp &&
        browserFollowUp.workflowAction === 'continue' &&
        browserFollowUp.continuation?.browserResearch === true &&
        Array.isArray(browserBody.urls) &&
        browserBody.urls.length === 2 &&
        browserBody.parentWorkflowId === browserWorkflowId
        ? ok('workflows.browser_research_followup', 'Browser research follow-up action', `${browserFollowUp.id} can continue ${browserBody.urls.length} URL(s)`)
        : fail('workflows.browser_research_followup', 'Browser research follow-up action', 'follow-ups did not expose persisted browser research continuation metadata', { browserWorkflowId, followUps }),
    );

    if (browserFollowUp) {
      const browserWorkNext = await ctx.api(`/api/work/next?actionId=${encodeURIComponent(browserFollowUp.id)}`);
      const browserNext = browserWorkNext.data?.next || {};
      out.push(
        browserWorkNext.ok &&
          browserNext.ok === true &&
          browserNext.executed === false &&
          browserNext.action?.id === browserFollowUp.id &&
          browserNext.result?.preview === true &&
          browserNext.result?.browserWorkflow?.body?.urls?.length === 2 &&
          String(browserNext.output || '').includes('Preview continuation for browser research')
          ? ok('workflows.browser_research_worknext', 'Browser research work-next preview', String(browserNext.output).slice(0, 140))
          : fail('workflows.browser_research_worknext', 'Browser research work-next preview', 'work-next did not expose browser research continuation without execution', browserWorkNext.data),
      );
    }

    return out;
  },
};
