import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'creative',
  async run(ctx) {
    const out = [];

    const benchmarks = await ctx.api('/api/creative/benchmarks?source=eval_creative_benchmarks', {
      timeoutMs: 30000,
    });
    const benchmarkData = benchmarks.data?.benchmarks || {};
    const cases = Array.isArray(benchmarkData.cases) ? benchmarkData.cases : [];
    const requiredCases = [
      'video_import_plan',
      'video_export_confirmation_gate',
      'music_sketch_plan',
      'music_mix_plan',
      'music_prompt_preview',
      'video_asset_requirement_gate',
    ];
    const hasRequiredCases = requiredCases.every((id) => cases.some((item) => item.id === id && item.ok));
    out.push(
      benchmarks.ok &&
        benchmarkData.ok === true &&
        benchmarkData.previewOnly === true &&
        benchmarkData.startsApps === false &&
        benchmarkData.executesCreativeActions === false &&
        benchmarkData.modelCalls === false &&
        benchmarkData.mutatesUserFiles === false &&
        benchmarkData.recordsWorkflowHistory === false &&
        benchmarkData.counts?.pass === benchmarkData.counts?.total &&
        benchmarkData.safety?.coversVideo === true &&
        benchmarkData.safety?.coversMusic === true &&
        benchmarkData.safety?.exportConfirmationGate === true &&
        benchmarkData.safety?.assetPathGate === true &&
        benchmarkData.safety?.noWorkflowHistory === true &&
        hasRequiredCases
        ? ok('creative.benchmarks', 'Creative workflow benchmarks', `${benchmarkData.summary || 'benchmarks passed'} · video/music gates covered`)
        : fail('creative.benchmarks', 'Creative workflow benchmarks', `GET /api/creative/benchmarks ${benchmarks.status}`, benchmarkData || benchmarks.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-creative-benchmarks'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      out.push(
        /Creative Workflow Benchmarks/.test(stdout) &&
          /preview-only=yes/.test(stdout) &&
          /export gate=yes/.test(stdout) &&
          /asset gate=yes/.test(stdout)
          ? ok('creative.benchmarks_cui', 'Creative benchmark CUI', 'config CUI prints creative benchmark evidence')
          : fail('creative.benchmarks_cui', 'Creative benchmark CUI', 'CUI output missing benchmark markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('creative.benchmarks_cui', 'Creative benchmark CUI', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
