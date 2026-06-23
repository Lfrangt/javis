import { ok, fail } from '../_client.mjs';

// Record & Replay demonstrations (README: "Record & Replay-inspired local skill
// draft generation: turn the inferred profile plus recent routing/workflow
// evidence into a reviewable SKILL.md draft"). Exercises the full lifecycle —
// start → capture → finish → replay/plan (DRY-RUN) → skill-draft — then DELETEs
// the throwaway demonstration. NEVER calls replay/run (that would execute the
// recorded actions). Mutates, but self-cleans like the collaboration lane.
export default {
  lane: 'demonstrations',
  async run(ctx) {
    const out = [];
    const tag = `eval/demonstrations/${Date.now()}`;
    let id = '';

    const start = await ctx.api('/api/demonstrations/start', {
      method: 'POST',
      body: { title: tag, goal: 'eval lifecycle probe', source: 'eval' },
    });
    id = start.data?.demonstration?.id || start.data?.id || '';
    if (!start.ok || !id) {
      out.push(fail('demos.start', 'Start demonstration', `POST /api/demonstrations/start ${start.status} ${start.error || start.data?.error || ''}`));
      return out;
    }
    out.push(ok('demos.start', 'Start demonstration', `recording ${id.slice(0, 8)} · status=${start.data?.demonstration?.status || '?'}`));

    try {
      const capture = await ctx.api('/api/demonstrations/capture', {
        method: 'POST',
        body: { kind: 'note', note: 'eval probe step', source: 'eval' },
      });
      out.push(
        capture.ok && capture.data?.ok !== false
          ? ok('demos.capture', 'Capture step', `step recorded (status=${capture.data?.demonstration?.status || '?'})`)
          : fail('demos.capture', 'Capture step', `POST /api/demonstrations/capture ${capture.status} ${capture.error || capture.data?.error || ''}`),
      );

      const finish = await ctx.api(`/api/demonstrations/${encodeURIComponent(id)}/finish`, {
        method: 'POST',
        body: { source: 'eval' },
      });
      const finished = finish.data?.demonstration;
      out.push(
        finish.ok && finished
          ? ok('demos.finish', 'Finish demonstration', `status=${finished.status} · ${finished.stepCount ?? (finished.steps || []).length} step(s)`)
          : fail('demos.finish', 'Finish demonstration', `POST …/finish ${finish.status} ${finish.error || finish.data?.error || ''}`),
      );

      // Replay PLAN only — must be a dry-run, must NOT execute.
      const plan = await ctx.api(`/api/demonstrations/${encodeURIComponent(id)}/replay/plan`, {
        method: 'POST',
        body: { source: 'eval' },
      });
      const safeDryRun = plan.ok && plan.data?.ok !== false && plan.data?.execute !== true;
      out.push(
        safeDryRun && Array.isArray(plan.data?.steps)
          ? ok('demos.replay_plan', 'Replay plan (dry-run)', `${plan.data.stepCount ?? plan.data.steps.length} planned step(s) · execute=${plan.data.execute} · mode=${plan.data.replayMode || '?'}`)
          : fail('demos.replay_plan', 'Replay plan (dry-run)', `replay/plan not a safe dry-run (status ${plan.status}, execute=${plan.data?.execute})`, plan.data),
      );

      // Bare replay/plan (no id) — plans the most-recent completed demonstration (this one).
      const barePlan = await ctx.api('/api/demonstrations/replay/plan', { method: 'POST', body: { source: 'eval' } });
      out.push(
        barePlan.ok && barePlan.data?.ok !== false && barePlan.data?.execute !== true
          ? ok('demos.replay_plan_bare', 'Replay plan (latest, dry-run)', `latest demo planned · execute=${barePlan.data?.execute}`)
          : fail('demos.replay_plan_bare', 'Replay plan (latest, dry-run)', `bare replay/plan not a safe dry-run (status ${barePlan.status}, execute=${barePlan.data?.execute})`, barePlan.data),
      );

      const draft = await ctx.api('/api/demonstrations/skill-draft', {
        method: 'POST',
        body: { id, source: 'eval' },
      });
      const skill = draft.data?.skill || draft.data;
      out.push(
        draft.ok && skill?.name && String(skill.markdown || '').length > 0
          ? ok('demos.skill_draft', 'Skill draft', `"${skill.name}" → ${skill.suggestedUserPath ? '…/' + String(skill.suggestedUserPath).split('/').slice(-2).join('/') : 'draft'} (${skill.markdown.length} chars)`)
          : fail('demos.skill_draft', 'Skill draft', `POST /api/demonstrations/skill-draft ${draft.status} ${draft.error || draft.data?.error || ''}`),
      );
    } finally {
      const del = await ctx.api(`/api/demonstrations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: { source: 'eval' },
      });
      out.push(
        del.ok && del.data?.removed === id
          ? ok('demos.cleanup', 'Cleanup', `throwaway demonstration ${id.slice(0, 8)} removed`)
          : fail('demos.cleanup', 'Cleanup', `DELETE /api/demonstrations/${id.slice(0, 8)} ${del.status} ${del.error || ''} — may leave a test demonstration behind`),
      );
    }

    return out;
  },
};
