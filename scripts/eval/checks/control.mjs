import { ok, fail } from '../_client.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export default {
  lane: 'control',
  async run(ctx) {
    const out = [];
    const current = await ctx.api('/api/control/mode');
    const originalMode = current.data?.controlMode?.mode;

    if (!current.ok || !originalMode) {
      return [fail('control.mode', 'Control mode API', `GET /api/control/mode ${current.status} ${current.error || ''}`)];
    }

    const modes = current.data?.controlMode?.availableModes || [];
    const modeIds = modes.map((mode) => mode.id);
    const required = ['observe_only', 'ask_before_action', 'trusted_local', 'takeover_supervised'];
    const missing = required.filter((mode) => !modeIds.includes(mode));
    out.push(
      missing.length === 0
        ? ok('control.modes', 'Control mode registry', `${modeIds.length} mode(s): ${modeIds.join(', ')}`, { modeIds })
        : fail('control.modes', 'Control mode registry', `missing: ${missing.join(', ')}`, { modeIds }),
    );

    try {
      const observe = await ctx.api('/api/control/mode', {
        method: 'PUT',
        body: { mode: 'observe_only', source: 'eval' },
      });
      const observePreview = await ctx.api('/api/actions/preview', {
        method: 'POST',
        body: { action: 'open_url', value: 'https://example.com/' },
      });
      const observeEvaluation = observePreview.data?.evaluation || {};
      out.push(
        observe.ok && observe.data?.controlMode?.mode === 'observe_only' && observeEvaluation.blocked === true
          ? ok('control.observe_only', 'Observe-only block', `risk-2 action blocked: ${observeEvaluation.reason || 'blocked'}`, { evaluation: observeEvaluation })
          : fail('control.observe_only', 'Observe-only block', `expected risk-2 preview block, got mode=${observe.data?.controlMode?.mode || '-'} status=${observePreview.status}`, { observe: observe.data, preview: observePreview.data }),
      );

      const ask = await ctx.api('/api/control/mode', {
        method: 'PUT',
        body: { mode: 'ask_before_action', source: 'eval' },
      });
      const askPreview = await ctx.api('/api/actions/preview', {
        method: 'POST',
        body: { action: 'open_url', value: 'https://example.com/' },
      });
      const askEvaluation = askPreview.data?.evaluation || {};
      out.push(
        ask.ok && ask.data?.controlMode?.mode === 'ask_before_action' && askEvaluation.needsApproval === true && askEvaluation.blocked !== true
          ? ok('control.ask_before_action', 'Ask-before-action gate', `risk-2 action requires approval: ${askEvaluation.reason || 'approval'}`, { evaluation: askEvaluation })
          : fail('control.ask_before_action', 'Ask-before-action gate', `expected risk-2 approval gate, got mode=${ask.data?.controlMode?.mode || '-'} status=${askPreview.status}`, { ask: ask.data, preview: askPreview.data }),
      );
    } finally {
      await ctx.api('/api/control/mode', {
        method: 'PUT',
        body: { mode: originalMode, source: 'eval_restore' },
      });
    }

    const restored = await ctx.api('/api/control/mode');
    out.push(
      restored.data?.controlMode?.mode === originalMode
        ? ok('control.restore', 'Control mode restore', `restored ${originalMode}`)
        : fail('control.restore', 'Control mode restore', `expected ${originalMode}, got ${restored.data?.controlMode?.mode || '-'}`, restored.data),
    );

    try {
      const { stdout } = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-control-readiness'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      out.push(
        stdout.includes('JAVIS Local Control Readiness') &&
          stdout.includes('Takeover posture:') &&
          stdout.includes('Readiness gates:') &&
          stdout.includes('Voice entry') &&
          stdout.includes('Screen awareness') &&
          stdout.includes('Browser control') &&
          stdout.includes('Codex and Claude Code') &&
          stdout.includes('Useful commands:')
          ? ok('control.readiness_cui', 'Control readiness CUI', 'config CUI prints local control readiness gates and next actions')
          : fail('control.readiness_cui', 'Control readiness CUI', 'expected --print-control-readiness to print readiness packet', { stdout: stdout.slice(0, 3000) }),
      );
    } catch (error) {
      out.push(fail('control.readiness_cui', 'Control readiness CUI', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
