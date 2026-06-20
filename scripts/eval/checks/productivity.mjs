import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

export default {
  lane: 'productivity',
  async run(ctx) {
    const out = [];

    const benchmarks = await ctx.api('/api/productivity/benchmarks?source=eval_productivity_benchmarks', {
      timeoutMs: 30000,
    });
    const benchmarkData = benchmarks.data?.benchmarks || {};
    const cases = Array.isArray(benchmarkData.cases) ? benchmarkData.cases : [];
    const requiredCases = [
      'note_capture_plan',
      'note_native_action_preview',
      'reminder_create_plan',
      'calendar_confirmation_gate',
      'email_draft_plan',
      'email_missing_recipient_gate',
      'email_send_blocked',
    ];
    const hasRequiredCases = requiredCases.every((id) => cases.some((item) => item.id === id && item.ok));
    out.push(
      benchmarks.ok &&
        benchmarkData.ok === true &&
        benchmarkData.previewOnly === true &&
        benchmarkData.startsApps === false &&
        benchmarkData.executesProductivityActions === false &&
        benchmarkData.sendsMessages === false &&
        benchmarkData.modelCalls === false &&
        benchmarkData.mutatesUserFiles === false &&
        benchmarkData.recordsWorkflowHistory === false &&
        benchmarkData.counts?.pass === benchmarkData.counts?.total &&
        benchmarkData.safety?.coversNotes === true &&
        benchmarkData.safety?.coversReminders === true &&
        benchmarkData.safety?.coversCalendar === true &&
        benchmarkData.safety?.coversMail === true &&
        benchmarkData.safety?.calendarConfirmationGate === true &&
        benchmarkData.safety?.emailRecipientGate === true &&
        benchmarkData.safety?.emailSendBlocked === true &&
        benchmarkData.safety?.nativeCreatePreview === true &&
        benchmarkData.safety?.noWorkflowHistory === true &&
        hasRequiredCases
        ? ok('productivity.benchmarks', 'Productivity workflow benchmarks', `${benchmarkData.summary || 'benchmarks passed'} · Notes/Reminders/Calendar/Mail native gates covered`)
        : fail('productivity.benchmarks', 'Productivity workflow benchmarks', `GET /api/productivity/benchmarks ${benchmarks.status}`, benchmarkData || benchmarks.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-productivity-benchmarks'], {
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
          /Productivity Workflow Benchmarks/.test(stdout) &&
          /preview-only=yes/.test(stdout) &&
          /native preview=yes/.test(stdout) &&
          /calendar gate=yes/.test(stdout) &&
          /email recipient gate=yes/.test(stdout) &&
          /email send blocked=yes/.test(stdout)
          ? ok('productivity.benchmarks_cui', 'Productivity benchmark CUI', 'config CUI prints productivity benchmark evidence')
          : fail('productivity.benchmarks_cui', 'Productivity benchmark CUI', 'CUI output missing benchmark markers', { stdout }),
      );
    } catch (error) {
      out.push(fail('productivity.benchmarks_cui', 'Productivity benchmark CUI', error instanceof Error ? error.message : String(error)));
    }

    const realtime = await ctx.api('/api/realtime/config', { timeoutMs: 15000 });
    const toolNames = realtime.data?.realtime?.toolNames || [];
    const requiredTools = ['plan_productivity_workflow', 'run_productivity_workflow', 'run_productivity_action'];
    const hasTools = requiredTools.every((name) => toolNames.includes(name));
    out.push(
      realtime.ok && hasTools
        ? ok('productivity.realtime_tools', 'Productivity Realtime tools', requiredTools.join(', '))
        : fail('productivity.realtime_tools', 'Productivity Realtime tools', 'Realtime tool inventory missing productivity tools', { requiredTools, toolNames }),
    );

    return out;
  },
};
