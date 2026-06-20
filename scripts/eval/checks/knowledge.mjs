import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail, skip } from '../_client.mjs';

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

    const mcpToolCallPreview = await ctx.api('/api/mcp/tool-call', {
      method: 'POST',
      body: {
        source: 'eval_knowledge_mcp_tool_call_preview',
        task: 'Preview an MCP tool call without execution.',
        serverName: 'pencil',
        toolName: 'get_guidelines',
        toolArguments: {},
        execute: false,
        limit: 20,
      },
      timeoutMs: 15000,
    });
    const mcpToolCallPreviewData = mcpToolCallPreview.data?.mcpToolCall || {};
    out.push(
      mcpToolCallPreview.ok &&
        mcpToolCallPreviewData.ok === true &&
        mcpToolCallPreviewData.previewOnly === true &&
        mcpToolCallPreviewData.executed === false &&
        mcpToolCallPreviewData.safety?.startsServers === false &&
        mcpToolCallPreviewData.safety?.commandsExecuted === false &&
        mcpToolCallPreviewData.safety?.callsMcpTools === false &&
        mcpToolCallPreviewData.safety?.approvalCallsMcpTools === true &&
        mcpToolCallPreviewData.safety?.toolResultSanitized === true &&
        Array.isArray(mcpToolCallPreviewData.actionPlan)
        ? ok('knowledge.mcp_tool_call_preview', 'MCP tool-call preview', `status=${mcpToolCallPreviewData.status || 'unknown'} · candidates=${mcpToolCallPreviewData.counts?.candidates || 0}`)
        : fail('knowledge.mcp_tool_call_preview', 'MCP tool-call preview', `POST /api/mcp/tool-call ${mcpToolCallPreview.status}`, mcpToolCallPreview.data),
    );

    const firstMcpServer = Array.isArray(mcpData.servers) ? mcpData.servers.find((server) => server?.name) : null;
    if (!firstMcpServer) {
      out.push(skip('knowledge.mcp_execution_approval_gate', 'MCP execution approval gate', 'no configured MCP server available for approval-gate creation'));
    } else {
      const mcpApproval = await ctx.api('/api/mcp/workflow', {
        method: 'POST',
        body: {
          source: 'eval_knowledge_mcp_approval',
          task: 'Prepare a confirmed MCP tool request without starting the server.',
          serverName: firstMcpServer.name,
          toolName: 'list_tools',
          execute: true,
          requestApproval: true,
          limit: 20,
        },
        timeoutMs: 15000,
      });
      const mcpApprovalData = mcpApproval.data?.mcpWorkflow || {};
      const approvalId = mcpApprovalData.approval?.id || '';
      let cleanupOk = false;
      if (approvalId) {
        await ctx.api(`/api/approvals/${approvalId}/reject`, {
          method: 'POST',
          body: { reason: 'eval cleanup: MCP approval gate verified without execution' },
          timeoutMs: 15000,
        });
        const removed = await ctx.api(`/api/approvals/${approvalId}`, {
          method: 'DELETE',
          timeoutMs: 15000,
        });
        cleanupOk = removed.ok === true;
      }
      out.push(
        mcpApproval.ok &&
          mcpApproval.status === 202 &&
          mcpApprovalData.ok === true &&
          mcpApprovalData.status === 'approval_required' &&
          mcpApprovalData.approvalRequired === true &&
          mcpApprovalData.approval?.status === 'pending' &&
          mcpApprovalData.safety?.startsServers === false &&
          mcpApprovalData.safety?.callsMcpTools === false &&
          mcpApprovalData.safety?.approvalCreatesNoToolCall === true &&
          cleanupOk
          ? ok('knowledge.mcp_execution_approval_gate', 'MCP execution approval gate', `created and cleaned approval ${approvalId}`)
          : fail('knowledge.mcp_execution_approval_gate', 'MCP execution approval gate', `POST /api/mcp/workflow ${mcpApproval.status}`, { response: mcpApproval.data, cleanupOk }),
      );
    }

    const stdioServers = Array.isArray(mcpData.servers)
      ? mcpData.servers.filter((server) => server?.enabled !== false && server?.transport === 'stdio' && server?.command)
      : [];
    const runnableStdioServer = stdioServers[0] || null;
    if (!runnableStdioServer) {
      out.push(skip('knowledge.mcp_stdio_tools_list_adapter', 'MCP stdio tools/list adapter', 'no stdio MCP server available for live adapter check'));
    } else {
      const mcpAdapterApproval = await ctx.api('/api/mcp/workflow', {
        method: 'POST',
        body: {
          source: 'eval_knowledge_mcp_stdio_adapter',
          task: 'Approve MCP stdio tools/list schema inspection only.',
          serverName: runnableStdioServer.name,
          toolName: 'list_tools',
          execute: true,
          requestApproval: true,
          limit: 20,
        },
        timeoutMs: 15000,
      });
      const approvalId = mcpAdapterApproval.data?.mcpWorkflow?.approval?.id || '';
      let approveResult = null;
      let output = null;
      let cleanupOk = false;
      if (approvalId) {
        approveResult = await ctx.api(`/api/approvals/${approvalId}/approve`, {
          method: 'POST',
          body: { reason: 'eval: MCP stdio tools/list adapter' },
          timeoutMs: 30000,
        });
        try {
          output = JSON.parse(approveResult.data?.output || '{}');
        } catch {
          output = null;
        }
        const removed = await ctx.api(`/api/approvals/${approvalId}`, {
          method: 'DELETE',
          timeoutMs: 15000,
        });
        cleanupOk = removed.ok === true;
      }
      if (output?.status === 'local_execution_disabled') {
        out.push(skip('knowledge.mcp_stdio_tools_list_adapter', 'MCP stdio tools/list adapter', 'local execution disabled; approval remained non-executing'));
      } else {
        out.push(
          mcpAdapterApproval.ok &&
            mcpAdapterApproval.status === 202 &&
            approveResult?.ok === true &&
            output?.ok === true &&
            output?.status === 'tools_listed' &&
            output?.adapter === 'stdio_tools_list' &&
            output?.safety?.startsServers === true &&
            output?.safety?.commandsExecuted === true &&
            output?.safety?.callsMcpTools === false &&
            output?.safety?.listsToolSchemas === true &&
            output?.safety?.envValuesRedacted === true &&
            Array.isArray(output?.tools) &&
            typeof output?.counts?.tools === 'number' &&
            cleanupOk
            ? ok('knowledge.mcp_stdio_tools_list_adapter', 'MCP stdio tools/list adapter', `${output.counts.tools || 0} tool schema(s) listed from ${output.serverName || runnableStdioServer.name}`)
            : fail('knowledge.mcp_stdio_tools_list_adapter', 'MCP stdio tools/list adapter', `approve ${approvalId || '-'} failed`, {
              approval: mcpAdapterApproval.data,
              approve: approveResult?.data,
              output,
              cleanupOk,
            }),
        );
      }
    }

    if (!runnableStdioServer) {
      out.push(skip('knowledge.mcp_stdio_tool_call_adapter', 'MCP stdio tools/call adapter', 'no stdio MCP server available for live tool-call check'));
    } else {
      const mcpToolCallApproval = await ctx.api('/api/mcp/tool-call', {
        method: 'POST',
        body: {
          source: 'eval_knowledge_mcp_tool_call_adapter',
          task: 'Approve one MCP stdio tools/call request.',
          serverName: runnableStdioServer.name,
          toolName: 'get_guidelines',
          toolArguments: {},
          execute: true,
          requestApproval: true,
          limit: 20,
        },
        timeoutMs: 15000,
      });
      const approvalId = mcpToolCallApproval.data?.mcpToolCall?.approval?.id || '';
      let approveResult = null;
      let output = null;
      let cleanupOk = false;
      if (approvalId) {
        approveResult = await ctx.api(`/api/approvals/${approvalId}/approve`, {
          method: 'POST',
          body: { reason: 'eval: MCP stdio tools/call adapter' },
          timeoutMs: 30000,
        });
        try {
          output = JSON.parse(approveResult.data?.output || '{}');
        } catch {
          output = null;
        }
        const removed = await ctx.api(`/api/approvals/${approvalId}`, {
          method: 'DELETE',
          timeoutMs: 15000,
        });
        cleanupOk = removed.ok === true;
      }
      if (output?.status === 'local_execution_disabled') {
        out.push(skip('knowledge.mcp_stdio_tool_call_adapter', 'MCP stdio tools/call adapter', 'local execution disabled; approval remained non-executing'));
      } else {
        const acceptableStatus = ['tool_called', 'tool_returned_error', 'tool_call_failed'].includes(output?.status);
        out.push(
          mcpToolCallApproval.ok &&
            mcpToolCallApproval.status === 202 &&
            approveResult?.ok === true &&
            output?.adapter === 'stdio_tools_call' &&
            acceptableStatus &&
            output?.safety?.startsServers === true &&
            output?.safety?.commandsExecuted === true &&
            output?.safety?.callsMcpTools === true &&
            output?.safety?.listsToolSchemas === true &&
            output?.safety?.envValuesRedacted === true &&
            cleanupOk
            ? ok('knowledge.mcp_stdio_tool_call_adapter', 'MCP stdio tools/call adapter', `${output.status} from ${output.serverName || runnableStdioServer.name}/${output.toolName || 'get_guidelines'}`)
            : fail('knowledge.mcp_stdio_tool_call_adapter', 'MCP stdio tools/call adapter', `approve ${approvalId || '-'} failed`, {
              approval: mcpToolCallApproval.data,
              approve: approveResult?.data,
              output,
              cleanupOk,
            }),
        );
      }
    }

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

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-mcp-tool-call', '--task', 'Preview one MCP call without executing', '--server', 'pencil', '--tool', 'get_guidelines', '--arguments', '{}'], {
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
        /MCP Tool Call Preview/.test(stdout) &&
          /preview-only=yes/.test(stdout) &&
          /starts servers=no/.test(stdout) &&
          /calls MCP tools=no/.test(stdout) &&
          /approval calls tool=yes/.test(stdout) &&
          /result sanitized=yes/.test(stdout)
          ? ok('knowledge.mcp_tool_call_cui', 'MCP tool-call preview CUI', 'config CUI prints MCP tool-call preview evidence')
          : fail('knowledge.mcp_tool_call_cui', 'MCP tool-call preview CUI', 'CUI output missing MCP tool-call preview markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('knowledge.mcp_tool_call_cui', 'MCP tool-call preview CUI', error instanceof Error ? error.message : String(error)));
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
