import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(stdout.slice(start, end + 1));
    throw new Error('stdout did not contain JSON');
  }
}

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

    try {
      const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'javis-productivity-dogfood-archives-'));
      const { stdout } = await execFileAsync(process.execPath, ['scripts/productivity-dogfood.mjs', '--suite', '--save-archive', '--json'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          JAVIS_PRODUCTIVITY_DOGFOOD_ARCHIVE_DIR: archiveDir,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const archive = parseJson(stdout);
      const apps = new Set((archive.cases || []).map((item) => item.app));
      const archiveOnDisk = archive.saved === true && archive.archiveFile && fs.existsSync(archive.archiveFile);
      let saved = null;
      if (archiveOnDisk) {
        saved = JSON.parse(fs.readFileSync(archive.archiveFile, 'utf8'));
      }
      const hasAllApps = ['Notes', 'Reminders', 'Calendar', 'Mail'].every((app) => apps.has(app));
      out.push(
        archive.ok === true &&
          archive.suite === true &&
          archive.execute === false &&
          archive.confirm === false &&
          archive.counts?.total === 4 &&
          archive.counts?.pass === 4 &&
          hasAllApps &&
          archive.safety?.previewOnly === true &&
          archive.safety?.startsApps === false &&
          archive.safety?.executesProductivityActions === false &&
          archive.safety?.sendsMessages === false &&
          archive.safety?.mutatesUserFiles === false &&
          archiveOnDisk &&
          saved?.id === archive.id &&
          Array.isArray(saved?.cases) &&
          saved.cases.length === 4
          ? ok('productivity.live_dogfood_archive', 'Productivity live dogfood archive', `preview suite archived ${archive.counts.pass}/${archive.counts.total} cases`)
          : fail('productivity.live_dogfood_archive', 'Productivity live dogfood archive', 'suite archive missing safety or coverage markers', {
              archive,
              archiveOnDisk,
              hasAllApps,
            }),
      );
    } catch (error) {
      out.push(fail('productivity.live_dogfood_archive', 'Productivity live dogfood archive', error instanceof Error ? error.message : String(error)));
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
