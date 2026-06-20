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

    const mcp = await ctx.api('/api/mcp/servers?source=eval_knowledge_mcp', { timeoutMs: 15000 });
    const mcpData = mcp.data?.mcp || {};
    out.push(
      mcp.ok &&
        mcpData.ok === true &&
        mcpData.safety?.readOnly === true &&
        mcpData.safety?.startsServers === false &&
        mcpData.safety?.commandsExecuted === false &&
        mcpData.safety?.envValuesRedacted === true &&
        mcpData.safety?.urlQueriesRedacted === true &&
        typeof mcpData.counts?.filesChecked === 'number' &&
        Array.isArray(mcpData.files) &&
        Array.isArray(mcpData.servers)
        ? ok('knowledge.mcp_discovery', 'MCP server discovery', `${mcpData.counts.servers || 0} server(s), ${mcpData.counts.filesFound || 0}/${mcpData.counts.filesChecked || 0} config file(s) found`)
        : fail('knowledge.mcp_discovery', 'MCP server discovery', `GET /api/mcp/servers ${mcp.status}`, mcp.data),
    );

    const mcpWorkflow = await ctx.api('/api/mcp/workflow', {
      method: 'POST',
      body: {
        source: 'eval_knowledge_mcp_workflow',
        task: 'Choose the MCP server for a browser or notes task, but do not execute.',
        execute: false,
        limit: 20,
      },
      timeoutMs: 15000,
    });
    const mcpWorkflowData = mcpWorkflow.data?.mcpWorkflow || {};
    out.push(
      mcpWorkflow.ok &&
        mcpWorkflowData.ok === true &&
        mcpWorkflowData.previewOnly === true &&
        mcpWorkflowData.executed === false &&
        mcpWorkflowData.safety?.readOnly === true &&
        mcpWorkflowData.safety?.startsServers === false &&
        mcpWorkflowData.safety?.commandsExecuted === false &&
        mcpWorkflowData.safety?.callsMcpTools === false &&
        mcpWorkflowData.safety?.envValuesRedacted === true &&
        mcpWorkflowData.safety?.requiresConfirmationForExecution === true &&
        Array.isArray(mcpWorkflowData.actionPlan) &&
        Array.isArray(mcpWorkflowData.candidates) &&
        typeof mcpWorkflowData.counts?.servers === 'number'
        ? ok('knowledge.mcp_workflow_preview', 'MCP workflow preview', `${mcpWorkflowData.counts.candidates || 0} candidate(s), status=${mcpWorkflowData.status || 'unknown'}`)
        : fail('knowledge.mcp_workflow_preview', 'MCP workflow preview', `POST /api/mcp/workflow ${mcpWorkflow.status}`, mcpWorkflow.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-mcp-servers'], {
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
        /MCP Server Discovery/.test(stdout) &&
          /read-only=yes/.test(stdout) &&
          /starts servers=no/.test(stdout) &&
          /env values redacted=yes/.test(stdout)
          ? ok('knowledge.mcp_cui', 'MCP discovery CUI', 'config CUI prints read-only MCP discovery evidence')
          : fail('knowledge.mcp_cui', 'MCP discovery CUI', 'CUI output missing MCP discovery markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('knowledge.mcp_cui', 'MCP discovery CUI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-mcp-workflow', '--task', 'Choose the MCP server for a browser task without executing'], {
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
        /MCP Workflow Preview/.test(stdout) &&
          /preview-only=yes/.test(stdout) &&
          /starts servers=no/.test(stdout) &&
          /calls MCP tools=no/.test(stdout) &&
          /confirmation required=yes/.test(stdout)
          ? ok('knowledge.mcp_workflow_cui', 'MCP workflow preview CUI', 'config CUI prints preview-only MCP workflow evidence')
          : fail('knowledge.mcp_workflow_cui', 'MCP workflow preview CUI', 'CUI output missing MCP workflow preview markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('knowledge.mcp_workflow_cui', 'MCP workflow preview CUI', error instanceof Error ? error.message : String(error)));
    }

    const realtime = await ctx.api('/api/realtime/config', { timeoutMs: 15000 });
    const toolNames = realtime.data?.realtime?.toolNames || [];
    const requiredTools = ['get_knowledge_vaults', 'search_knowledge_notes', 'run_knowledge_workflow', 'get_mcp_servers', 'plan_mcp_workflow'];
    const hasTools = requiredTools.every((name) => toolNames.includes(name));
    out.push(
      realtime.ok && hasTools
        ? ok('knowledge.realtime_tools', 'Knowledge Realtime tools', requiredTools.join(', '))
        : fail('knowledge.realtime_tools', 'Knowledge Realtime tools', 'Realtime tool inventory missing knowledge tools', { requiredTools, toolNames }),
    );

    return out;
  },
};
