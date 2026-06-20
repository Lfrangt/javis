import { ok, fail } from '../_client.mjs';

function stepIds(loop = {}) {
  return new Set((loop.steps || []).map((step) => step.id));
}

export default {
  lane: 'autonomy',
  async run(ctx) {
    const out = [];

    const preview = await ctx.api('/api/autonomy/run', {
      method: 'POST',
      body: {
        task: '帮我检查当前电脑状态，然后给出下一步怎么继续做 JAVIS，先不要执行。',
        execute: false,
        observe: true,
        includeAccessibility: false,
        captureScreen: false,
        useMemory: false,
        source: 'eval_autonomy_preview',
      },
      timeoutMs: 30000,
    });
    const loop = preview.data?.autonomy || {};
    const ids = stepIds(loop);
    out.push(
      preview.ok &&
        loop.ok === true &&
        loop.status === 'preview' &&
        loop.executeRequested === false &&
        loop.executed === false &&
        loop.safety?.defaultPreview === true &&
        loop.safety?.usesExistingActionPolicy === true &&
        loop.safety?.noDirectShell === true &&
        loop.safety?.recoveryBudget?.retryRequested === false &&
        loop.safety?.recoveryBudget?.attempted === 0 &&
        ids.has('route_preview') &&
        ids.has('observe') &&
        ids.has('work_next_preview') &&
        ids.has('verify_progress') &&
        ids.has('recovery_scan') &&
        loop.route?.lane &&
        loop.route?.contextPlan?.mode &&
        loop.workNext &&
        loop.progress &&
        loop.recovery?.snapshot?.counts
        ? ok('autonomy.preview_loop', 'Autonomy loop preview', `${loop.route.label || loop.route.lane} · ${loop.steps.length} bounded step(s)`)
        : fail('autonomy.preview_loop', 'Autonomy loop preview', `expected preview-only route/observe/work-next/verify/recovery envelope (${preview.status})`, preview.data),
    );

    const voiceTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval_autonomy_voice_tool',
        name: 'run_autonomy_loop',
        arguments: {
          task: '检查当前工作状态并提出下一步，先不要执行。',
          execute: false,
          observe: true,
          includeAccessibility: false,
          captureScreen: false,
          useMemory: false,
          maxSteps: 6,
        },
      },
      timeoutMs: 30000,
    });
    let voiceOutput = null;
    try {
      voiceOutput = JSON.parse(voiceTool.data?.output || '{}');
    } catch {}
    const voiceIds = stepIds(voiceOutput || {});
    out.push(
      voiceTool.ok &&
        voiceTool.data?.ok === true &&
        voiceOutput?.status === 'preview' &&
        voiceOutput?.executed === false &&
        voiceIds.has('route_preview') &&
        voiceIds.has('work_next_preview') &&
        voiceIds.has('recovery_scan') &&
        voiceOutput?.safety?.recoveryBudget?.retryRequested === false &&
        voiceOutput?.safety?.usesExistingRouting === true
        ? ok('autonomy.voice_tool', 'Realtime autonomy voice tool', `${voiceOutput.route?.label || voiceOutput.route?.lane} preview exposed through tool execution`)
        : fail('autonomy.voice_tool', 'Realtime autonomy voice tool', `expected run_autonomy_loop tool preview (${voiceTool.status})`, { response: voiceTool.data, output: voiceOutput }),
    );

    const config = await ctx.api('/api/realtime/config');
    const realtime = config.data?.realtime || {};
    const toolNames = realtime.toolNames || [];
    out.push(
      config.ok &&
        toolNames.includes('run_autonomy_loop') &&
        realtime.instructionChecks?.autonomyLoop === true
        ? ok('autonomy.realtime_config', 'Realtime autonomy tool config', 'run_autonomy_loop is available to live voice with bounded-loop instructions')
        : fail('autonomy.realtime_config', 'Realtime autonomy tool config', 'Realtime config did not expose run_autonomy_loop or its instructions', realtime),
    );

    return out;
  },
};
