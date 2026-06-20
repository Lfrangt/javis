import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'knowledge',
  async run(ctx) {
    const out = [];

    const benchmarks = await ctx.api('/api/knowledge/benchmarks?source=eval_knowledge_benchmarks', {
      timeoutMs: 30000,
    });
    const data = benchmarks.data?.benchmarks || {};
    const cases = Array.isArray(data.cases) ? data.cases : [];
    const requiredCases = [
      'vault_discovery_fixture',
      'markdown_search_fixture',
      'create_note_preview',
      'create_note_confirmation_gate',
      'confirmed_fixture_write',
    ];
    const hasRequiredCases = requiredCases.every((id) => cases.some((item) => item.id === id && item.ok));
    out.push(
      benchmarks.ok &&
        data.ok === true &&
        data.fixtureOnly === true &&
        data.startsApps === false &&
        data.modelCalls === false &&
        data.mutatesUserFiles === false &&
        data.recordsWorkflowHistory === false &&
        data.writesFixture === true &&
        data.counts?.pass === data.counts?.total &&
        data.safety?.cleanupOk === true &&
        data.safety?.noUserFileMutation === true &&
        data.safety?.confirmRequiredForWrite === true &&
        data.safety?.confirmedFixtureWrite === true &&
        data.safety?.noWorkflowHistory === true &&
        hasRequiredCases
        ? ok('knowledge.benchmarks', 'Knowledge workflow benchmarks', `${data.summary || 'benchmarks passed'} · vault/search/write gates covered`)
        : fail('knowledge.benchmarks', 'Knowledge workflow benchmarks', `GET /api/knowledge/benchmarks ${benchmarks.status}`, data || benchmarks.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-knowledge-benchmarks'], {
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
        /Knowledge Workflow Benchmarks/.test(stdout) &&
          /fixture-only=yes/.test(stdout) &&
          /write gate=yes/.test(stdout) &&
          /fixture write=yes/.test(stdout)
          ? ok('knowledge.benchmarks_cui', 'Knowledge benchmark CUI', 'config CUI prints knowledge benchmark evidence')
          : fail('knowledge.benchmarks_cui', 'Knowledge benchmark CUI', 'CUI output missing knowledge benchmark markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('knowledge.benchmarks_cui', 'Knowledge benchmark CUI', error instanceof Error ? error.message : String(error)));
    }

    const realtime = await ctx.api('/api/realtime/config', { timeoutMs: 15000 });
    const toolNames = realtime.data?.realtime?.toolNames || [];
    const requiredTools = ['get_knowledge_vaults', 'search_knowledge_notes', 'run_knowledge_workflow'];
    const hasTools = requiredTools.every((name) => toolNames.includes(name));
    out.push(
      realtime.ok && hasTools
        ? ok('knowledge.realtime_tools', 'Knowledge Realtime tools', requiredTools.join(', '))
        : fail('knowledge.realtime_tools', 'Knowledge Realtime tools', 'Realtime tool inventory missing knowledge tools', { requiredTools, toolNames }),
    );

    return out;
  },
};
