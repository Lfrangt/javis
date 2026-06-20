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

function parseToolOutput(response) {
  try {
    return JSON.parse(response.data?.output || '{}');
  } catch {
    return {};
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

    const archivePreview = await ctx.api('/api/productivity/dogfood/archive?source=eval_productivity_archive_preview', {
      timeoutMs: 45000,
    });
    const archivePreviewData = archivePreview.data?.archive || {};
    const archivePreviewApps = new Set((archivePreviewData.cases || []).map((item) => item.app));
    out.push(
      archivePreview.ok &&
        archivePreviewData.ok === true &&
        archivePreviewData.suite === true &&
        archivePreviewData.saved === false &&
        archivePreviewData.execute === false &&
        archivePreviewData.counts?.total === 4 &&
        archivePreviewData.counts?.pass === 4 &&
        ['Notes', 'Reminders', 'Calendar', 'Mail'].every((app) => archivePreviewApps.has(app)) &&
        archivePreviewData.safety?.previewOnly === true &&
        archivePreviewData.safety?.startsApps === false &&
        archivePreviewData.safety?.executesProductivityActions === false &&
        archivePreviewData.safety?.sendsMessages === false &&
        archivePreviewData.safety?.mutatesUserFiles === false &&
        archivePreviewData.safety?.recordsWorkflowHistory === false
        ? ok('productivity.dogfood_archive_api_preview', 'Productivity dogfood archive API preview', 'four-app preview archive is safe and complete')
        : fail('productivity.dogfood_archive_api_preview', 'Productivity dogfood archive API preview', `GET /api/productivity/dogfood/archive ${archivePreview.status}`, archivePreview.data),
    );

    const archiveSave = await ctx.api('/api/productivity/dogfood/archive', {
      method: 'POST',
      body: { source: 'eval_productivity_archive_save', limit: 2 },
      timeoutMs: 45000,
    });
    const archiveSaveData = archiveSave.data?.archive || {};
    const archiveSaveFile = archiveSave.data?.metadata?.file || archiveSaveData.archiveFile || archiveSaveData.file?.path || '';
    out.push(
      archiveSave.ok &&
        archiveSave.data?.saved === true &&
        archiveSaveData.ok === true &&
        archiveSaveData.saved === true &&
        archiveSaveData.counts?.pass === 4 &&
        archiveSaveData.safety?.previewOnly === true &&
        archiveSaveData.safety?.startsApps === false &&
        archiveSaveData.safety?.sendsMessages === false &&
        archiveSaveData.safety?.mutatesUserFiles === false &&
        archiveSaveFile.includes('productivity-dogfood-archives') &&
        fs.existsSync(archiveSaveFile)
        ? ok('productivity.dogfood_archive_api_save', 'Productivity dogfood archive API save', `saved preview archive ${archiveSaveData.counts.pass}/${archiveSaveData.counts.total}`)
        : fail('productivity.dogfood_archive_api_save', 'Productivity dogfood archive API save', `POST /api/productivity/dogfood/archive ${archiveSave.status}`, archiveSave.data),
    );

    const productivityTool = await ctx.api('/api/tools/execute', {
      method: 'POST',
      body: {
        source: 'eval',
        name: 'save_productivity_dogfood_archive',
        arguments: { limit: 2 },
      },
      timeoutMs: 45000,
    });
    const productivityToolOutput = parseToolOutput(productivityTool);
    const productivityToolArchive = productivityToolOutput.archive || {};
    const productivityToolFile = productivityToolOutput.metadata?.file || productivityToolArchive.archiveFile || productivityToolArchive.file?.path || '';
    out.push(
      productivityTool.ok &&
        productivityTool.data?.ok === true &&
        productivityToolOutput.saved === true &&
        productivityToolArchive.ok === true &&
        productivityToolArchive.counts?.total === 4 &&
        productivityToolArchive.counts?.pass === 4 &&
        productivityToolArchive.safety?.previewOnly === true &&
        productivityToolArchive.safety?.startsApps === false &&
        productivityToolArchive.safety?.sendsMessages === false &&
        productivityToolArchive.safety?.mutatesUserFiles === false &&
        fs.existsSync(productivityToolFile)
        ? ok('productivity.dogfood_archive_voice_tool', 'Productivity dogfood archive voice tool', 'save_productivity_dogfood_archive saved safe preview evidence')
        : fail('productivity.dogfood_archive_voice_tool', 'Productivity dogfood archive voice tool', `tool execute ${productivityTool.status}`, productivityTool.data),
    );

    const evidence = await ctx.api('/api/realtime/evidence');
    const productivityEvidence = evidence.data?.evidence?.productivityDogfoodTools;
    const productivityEvents = Array.isArray(productivityEvidence?.recent) ? productivityEvidence.recent : [];
    out.push(
      evidence.ok &&
        productivityEvidence?.hasSavedArchive === true &&
        productivityEvidence?.hasSafePreview === true &&
        productivityEvidence?.sendsMessages === false &&
        productivityEvidence?.mutatesUserFiles === false &&
        productivityEvents.some((event) => (
          event.name === 'save_productivity_dogfood_archive' &&
          event.source === 'eval' &&
          event.productivityDogfood?.saved === true &&
          event.productivityDogfood?.previewOnly === true &&
          event.productivityDogfood?.pass === 4 &&
          event.productivityDogfood?.sendsMessages === false
        ))
        ? ok('productivity.dogfood_archive_voice_evidence', 'Productivity dogfood archive voice evidence', 'saved productivity dogfood archive is visible in Realtime evidence')
        : fail('productivity.dogfood_archive_voice_evidence', 'Productivity dogfood archive voice evidence', 'expected save_productivity_dogfood_archive in realtime evidence', productivityEvidence),
    );

    const realtime = await ctx.api('/api/realtime/config', { timeoutMs: 15000 });
    const toolNames = realtime.data?.realtime?.toolNames || [];
    const requiredTools = ['plan_productivity_workflow', 'run_productivity_workflow', 'run_productivity_action', 'get_productivity_dogfood_archive', 'save_productivity_dogfood_archive'];
    const hasTools = requiredTools.every((name) => toolNames.includes(name));
    out.push(
      realtime.ok && hasTools
        ? ok('productivity.realtime_tools', 'Productivity Realtime tools', requiredTools.join(', '))
        : fail('productivity.realtime_tools', 'Productivity Realtime tools', 'Realtime tool inventory missing productivity tools', { requiredTools, toolNames }),
    );

    return out;
  },
};
