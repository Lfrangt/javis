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
          Array.isArray(continuation.relatedWorkflows) &&
          typeof memory.count === 'number' &&
          memory.learningEvidence?.usedInPrompt === true
          ? ok('workflows.continuation_preview', 'Memory-aware continuation preview', `${memory.count} memory match(es), ${continuation.relatedWorkflows.length} related workflow(s)`)
          : fail('workflows.continuation_preview', 'Memory-aware continuation preview', 'continuation preview did not expose memory-aware prompt context without queueing work', preview.data),
      );
    }

    return out;
  },
};
