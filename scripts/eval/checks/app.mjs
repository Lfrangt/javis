import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'app',
  async run(ctx) {
    const out = [];

    const benchmarks = await ctx.api('/api/app/benchmarks?source=eval_app_benchmarks', {
      timeoutMs: 30000,
    });
    const benchmarkData = benchmarks.data?.benchmarks || {};
    const cases = Array.isArray(benchmarkData.cases) ? benchmarkData.cases : [];
    const requiredCases = [
      'calculator_close_plan',
      'textedit_type_plan',
      'current_app_control_plan',
      'explicit_workflow_preview',
      'unsafe_delete_rejected',
    ];
    const hasRequiredCases = requiredCases.every((id) => cases.some((item) => item.id === id && item.ok));
    out.push(
      benchmarks.ok &&
        benchmarkData.ok === true &&
        benchmarkData.previewOnly === true &&
        benchmarkData.startsApps === false &&
        benchmarkData.executesAppActions === false &&
        benchmarkData.modelCalls === false &&
        benchmarkData.mutatesUserFiles === false &&
        benchmarkData.recordsWorkflowHistory === false &&
        benchmarkData.counts?.pass === benchmarkData.counts?.total &&
        benchmarkData.safety?.noAppLaunch === true &&
        benchmarkData.safety?.noUiActions === true &&
        benchmarkData.safety?.noModelCalls === true &&
        benchmarkData.safety?.unsafeDeleteRejected === true &&
        benchmarkData.safety?.noWorkflowHistory === true &&
        benchmarkData.safety?.coversOpenClose === true &&
        benchmarkData.safety?.coversTypeText === true &&
        benchmarkData.safety?.coversCurrentAppControl === true &&
        benchmarkData.safety?.coversExplicitPreview === true &&
        hasRequiredCases
        ? ok('app.workflow_benchmarks', 'App workflow benchmarks', `${benchmarkData.summary || 'benchmarks passed'} · preview/no-history gates covered`)
        : fail('app.workflow_benchmarks', 'App workflow benchmarks', `GET /api/app/benchmarks ${benchmarks.status}`, benchmarkData || benchmarks.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-app-benchmarks'], {
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
        /App Workflow Benchmarks/.test(stdout) &&
          /preview-only=yes/.test(stdout) &&
          /unsafe delete=yes/.test(stdout) &&
          /no app launch=yes/.test(stdout)
          ? ok('app.workflow_benchmarks_cui', 'App workflow benchmark CUI', 'config CUI prints app workflow benchmark evidence')
          : fail('app.workflow_benchmarks_cui', 'App workflow benchmark CUI', 'CUI output missing benchmark markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('app.workflow_benchmarks_cui', 'App workflow benchmark CUI', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
