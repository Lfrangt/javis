import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

function spawnWithInput(command, args = [], options = {}, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = Number(options.timeout || 30000);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > Number(options.maxBuffer || 1024 * 1024)) {
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command exited with code ${code}: ${stderr || stdout}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

function parseJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object in output.');
  return JSON.parse(raw.slice(start, end + 1));
}

function hasForbiddenHistoryPayload(value) {
  if (!value || typeof value !== 'object') return false;
  const forbidden = new Set([
    'rawAudio',
    'audioData',
    'screenImage',
    'imageDataUrl',
    'clipboardText',
    'accessibilityNodes',
    'nodes',
  ]);
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.has(key)) return true;
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return false;
}

export default {
  lane: 'voice-command',
  async run(ctx) {
    const out = [];

    const preview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '帮我整理当前工作状态，给我一个三步计划，先不要执行。',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_preview',
      },
      timeoutMs: 30000,
    });
    const previewData = preview.data || {};
    out.push(
      preview.ok &&
        previewData.ok === true &&
        previewData.channel === 'local_voice_command' &&
        previewData.executed === false &&
        previewData.context?.metadataOnly === true &&
        previewData.context?.includesScreenImage === false &&
        previewData.context?.includesClipboardText === false &&
        typeof previewData.context?.summary === 'string' &&
        previewData.context?.prompt?.includes('Local Mac context for this voice command:') &&
        previewData.route?.decision?.lane &&
        previewData.speech?.dryRun === true &&
        previewData.safety?.startsMicrophone === false &&
        previewData.safety?.usesRealtime === false &&
        previewData.safety?.storesRawAudio === false &&
        previewData.safety?.usesMemory === false &&
        previewData.safety?.usesContextMetadata === true &&
        previewData.safety?.speaksAudio === false
        ? ok('voice_command.preview', 'Local voice command preview', `${previewData.route.decision.lane} · speech dry-run · context=${previewData.context.summary || 'metadata'} · no mic/realtime`)
        : fail('voice_command.preview', 'Local voice command preview', `POST /api/voice/command ${preview.status}`, preview.data),
    );

    const screenContext = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '请根据当前上下文帮我判断这个请求适合哪个工作通道，先不要执行。',
        execute: false,
        includeScreen: true,
        includeAccessibility: true,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_screen_context',
      },
      timeoutMs: 30000,
    });
    const contextData = screenContext.data?.context || {};
    out.push(
      screenContext.ok &&
        screenContext.data?.ok === true &&
        contextData.metadataOnly === true &&
        contextData.includeScreenRequested === true &&
        contextData.includesScreenImage === false &&
        contextData.includesClipboardText === false &&
        contextData.includesAccessibilityNodes === false &&
        contextData.includeAccessibilityRequested === true &&
        !('imageDataUrl' in (contextData.screen || {})) &&
        !('text' in (contextData.clipboard || {})) &&
        !('nodes' in (contextData.accessibility || {})) &&
        typeof contextData.accessibility?.nodeCount === 'number' &&
        typeof contextData.accessibility?.outline === 'string' &&
        typeof contextData.frontmost?.app === 'string' &&
        typeof contextData.browser?.host === 'string' &&
        typeof contextData.prompt === 'string' &&
        contextData.prompt.includes('UI outline:') &&
        contextData.prompt.includes('Clipboard:')
        ? ok('voice_command.context_metadata', 'Voice command context metadata', `${contextData.summary || 'metadata'} · screenImage=no clipboardText=no axNodes=no`)
        : fail('voice_command.context_metadata', 'Voice command context metadata', `expected metadata-only context, got ${screenContext.status}`, screenContext.data),
    );

    const quickLocalAnswer = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '你能用一句话回答我吗？',
        execute: true,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_quick_hold',
      },
      timeoutMs: 30000,
    });
    const localAnswerData = quickLocalAnswer.data || {};
    out.push(
      quickLocalAnswer.ok &&
        localAnswerData.ok === true &&
        localAnswerData.requestedExecute === true &&
        localAnswerData.executed === true &&
        localAnswerData.heldReason === 'quick_lane_local_answer' &&
        localAnswerData.localQuickAnswer?.reason === 'one_sentence_ack' &&
        localAnswerData.route?.decision?.lane === 'quick' &&
        localAnswerData.safety?.callsOpenAIImmediately === false &&
        localAnswerData.safety?.usesLocalQuickAnswer === true &&
        localAnswerData.speech?.dryRun === true &&
        String(localAnswerData.output || '').includes('本地')
        ? ok('voice_command.quick_local_answer', 'Quick lane local answer', 'simple quick execute is answered locally without spending OpenAI quota')
        : fail('voice_command.quick_local_answer', 'Quick lane local answer', `expected local quick answer, got ${quickLocalAnswer.status}`, quickLocalAnswer.data),
    );

    const quickHeld = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '请用一句话解释量子纠缠的数学形式？',
        execute: true,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_quick_hold',
      },
      timeoutMs: 30000,
    });
    const heldData = quickHeld.data || {};
    out.push(
      quickHeld.ok &&
        heldData.ok === true &&
        heldData.requestedExecute === true &&
        heldData.executed === false &&
        heldData.heldReason === 'quick_lane_cloud_call_not_allowed' &&
        heldData.route?.decision?.lane === 'quick' &&
        heldData.safety?.callsOpenAIImmediately === false &&
        heldData.safety?.usesLocalQuickAnswer === false &&
        heldData.speech?.dryRun === true
        ? ok('voice_command.quick_hold', 'Quick lane cloud hold', 'unhandled quick execute is held locally instead of spending cloud quota')
        : fail('voice_command.quick_hold', 'Quick lane cloud hold', `expected held quick lane, got ${quickHeld.status}`, quickHeld.data),
    );

    const spendGuardBeforeVoice = await ctx.api('/api/openai/spend-guard');
    const spendGuardBefore = spendGuardBeforeVoice.data?.spendGuard || {};
    const naturalSpendStatus = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '我昨天都没测怎么就消耗了我的 API 额度？现在会不会继续花钱？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_openai_spend_status',
      },
      timeoutMs: 30000,
    });
    const naturalSpendStatusData = naturalSpendStatus.data || {};
    const naturalSpendStatusRoute = naturalSpendStatusData.route || {};
    const spendStatus = naturalSpendStatusRoute.data?.spendStatus || {};
    const spendGuardAfterVoice = await ctx.api('/api/openai/spend-guard');
    const spendGuardAfter = spendGuardAfterVoice.data?.spendGuard || {};
    out.push(
      spendGuardBeforeVoice.ok &&
        naturalSpendStatus.ok &&
        naturalSpendStatusData.ok === true &&
        naturalSpendStatusData.executed === false &&
        naturalSpendStatusRoute.decision?.localCommand === 'openai_spend_status' &&
        naturalSpendStatusRoute.localCommand?.intent === 'openai_spend_status' &&
        spendStatus.safety?.callsOpenAI === false &&
        spendStatus.safety?.createsSpendLease === false &&
        spendStatus.spendGuard?.mode === 'off' &&
        spendStatus.spendGuard?.hardSpendLock === true &&
        spendStatus.spendGuard?.dailyRequestLimit === 0 &&
        spendStatus.egressGuard?.mode === 'scoped_allow_only' &&
        typeof naturalSpendStatusRoute.output === 'string' &&
        naturalSpendStatusRoute.output.includes('OpenAI spend:') &&
        naturalSpendStatusRoute.output.includes('Blocked locally:') &&
        naturalSpendStatusData.safety?.startsMicrophone === false &&
        naturalSpendStatusData.safety?.usesRealtime === false &&
        naturalSpendStatusData.safety?.callsOpenAIImmediately === false &&
        spendGuardAfterVoice.ok &&
        Number(spendGuardAfter.counts?.total || 0) === Number(spendGuardBefore.counts?.total || 0) &&
        Number(spendGuardAfter.counts?.blocked || 0) === Number(spendGuardBefore.counts?.blocked || 0)
        ? ok('voice_command.openai_spend_status', 'Natural OpenAI spend-status voice command', 'API quota/cost questions read local spend guard without cloud, lease creation, mic, or Realtime')
        : fail('voice_command.openai_spend_status', 'Natural OpenAI spend-status voice command', 'natural API spend question did not use the local spend guard safely', {
          before: spendGuardBeforeVoice.data,
          command: naturalSpendStatus.data,
          after: spendGuardAfterVoice.data,
        }),
    );

    const naturalIncidentReport = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '不是谁给我开了这么多个窗口啊？谁干的？查一下本地审计。',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_incident_report',
      },
      timeoutMs: 30000,
    });
    const naturalIncidentReportData = naturalIncidentReport.data || {};
    const incident = naturalIncidentReportData.route?.data?.incident || {};
    out.push(
      naturalIncidentReport.ok &&
        naturalIncidentReportData.ok === true &&
        naturalIncidentReportData.executed === false &&
        naturalIncidentReportData.route?.decision?.localCommand === 'incident_report' &&
        naturalIncidentReportData.route?.localCommand?.intent === 'incident_report' &&
        typeof naturalIncidentReportData.route?.output === 'string' &&
        naturalIncidentReportData.route.output.includes('Incident report:') &&
        naturalIncidentReportData.route.output.includes('边界:') &&
        incident.version === 1 &&
        incident.safety?.readOnly === true &&
        incident.safety?.usesLocalAuditOnly === true &&
        incident.safety?.startsMicrophone === false &&
        incident.safety?.usesRealtime === false &&
        incident.safety?.capturesScreen === false &&
        incident.safety?.readsClipboardText === false &&
        incident.safety?.opensTerminal === false &&
        incident.safety?.executesActions === false &&
        naturalIncidentReportData.safety?.startsMicrophone === false &&
        naturalIncidentReportData.safety?.usesRealtime === false &&
        naturalIncidentReportData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_incident_report', 'Natural incident-report voice command', '谁干的/窗口问题 routes to local audit report without mic, Realtime, screen, clipboard, Terminal, or actions')
        : fail('voice_command.natural_incident_report', 'Natural incident-report voice command', 'natural incident question did not use the local audit report path safely', naturalIncidentReport.data),
    );

    const directIncidentReport = await ctx.api('/api/incident/report?query=%E7%AA%97%E5%8F%A3&limit=5&auditLimit=120', {
      timeoutMs: 30000,
    });
    const directIncident = directIncidentReport.data?.incident || {};
    out.push(
      directIncidentReport.ok &&
        directIncident.version === 1 &&
        directIncident.safety?.readOnly === true &&
        directIncident.safety?.usesLocalAuditOnly === true &&
        directIncident.safety?.startsMicrophone === false &&
        directIncident.safety?.usesRealtime === false &&
        directIncident.safety?.capturesScreen === false &&
        directIncident.safety?.readsClipboardText === false &&
        directIncident.safety?.opensTerminal === false &&
        directIncident.safety?.executesActions === false
        ? ok('voice_command.incident_report_api', 'Incident report API', `${directIncident.likelyCause?.id || 'audit'} · ${directIncident.audit?.returned ?? 0}/${directIncident.audit?.scanned ?? 0} event(s)`)
        : fail('voice_command.incident_report_api', 'Incident report API', 'GET /api/incident/report did not return the read-only local-audit contract', directIncidentReport.data),
    );

    const naturalVoiceLatency = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '语音延迟怎么样？为什么有点慢，查一下本地性能。',
        execute: false,
        includeScreen: false,
        includeAccessibility: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_latency',
      },
      timeoutMs: 30000,
    });
    const naturalVoiceLatencyData = naturalVoiceLatency.data || {};
    const voiceLatencyRoute = naturalVoiceLatencyData.route || {};
    const voiceLatency = voiceLatencyRoute.data?.latency || {};
    out.push(
      naturalVoiceLatency.ok &&
        naturalVoiceLatencyData.ok === true &&
        naturalVoiceLatencyData.executed === false &&
        voiceLatencyRoute.decision?.localCommand === 'voice_latency' &&
        voiceLatencyRoute.localCommand?.intent === 'voice_latency' &&
        typeof voiceLatencyRoute.output === 'string' &&
        voiceLatencyRoute.output.includes('Voice latency:') &&
        voiceLatency.version === 1 &&
        ['fast', 'watch', 'slow', 'no_data'].includes(voiceLatency.status) &&
        typeof voiceLatency.latency?.avgMs === 'number' &&
        typeof voiceLatency.latency?.p90Ms === 'number' &&
        typeof voiceLatency.latency?.p95Ms === 'number' &&
        voiceLatency.safety?.readOnly === true &&
        voiceLatency.safety?.localAuditOnly === true &&
        voiceLatency.safety?.startsMicrophone === false &&
        voiceLatency.safety?.usesRealtime === false &&
        voiceLatency.safety?.capturesScreen === false &&
        voiceLatency.safety?.readsClipboardText === false &&
        voiceLatency.safety?.opensTerminal === false &&
        voiceLatency.safety?.executesActions === false &&
        voiceLatencyRoute.contextPlan?.needs?.screen === false &&
        voiceLatencyRoute.contextPlan?.needs?.accessibility === false &&
        naturalVoiceLatencyData.safety?.startsMicrophone === false &&
        naturalVoiceLatencyData.safety?.usesRealtime === false &&
        naturalVoiceLatencyData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_latency_status', 'Natural voice latency command', `${voiceLatency.status} · avg ${voiceLatency.latency?.avgMs || 0}ms · p90 ${voiceLatency.latency?.p90Ms || 0}ms`)
        : fail('voice_command.natural_latency_status', 'Natural voice latency command', 'expected natural latency question to use read-only local audit metrics without mic, Realtime, screen, or Terminal', naturalVoiceLatency.data),
    );

    const latencyWithRedundantContext = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '语音延迟怎么样？',
        execute: false,
        includeScreen: true,
        includeAccessibility: true,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_latency_skip_context',
      },
      timeoutMs: 30000,
    });
    const latencyWithRedundantContextData = latencyWithRedundantContext.data || {};
    const skippedContext = latencyWithRedundantContextData.context || {};
    out.push(
      latencyWithRedundantContext.ok &&
        latencyWithRedundantContextData.ok === true &&
        latencyWithRedundantContextData.executed === false &&
        latencyWithRedundantContextData.route?.decision?.localCommand === 'voice_latency' &&
        latencyWithRedundantContextData.route?.contextPlan?.needs?.screen === false &&
        latencyWithRedundantContextData.route?.contextPlan?.needs?.accessibility === false &&
        skippedContext.skippedPreRouteContext === true &&
        skippedContext.skipReason === 'deterministic_local_command_owns_context' &&
        skippedContext.localCommand === 'voice_latency' &&
        skippedContext.includeScreenRequested === true &&
        skippedContext.includeAccessibilityRequested === true &&
        skippedContext.includesScreenImage === false &&
        skippedContext.includesAccessibilityNodes === false &&
        skippedContext.screen?.available === false &&
        skippedContext.accessibility?.requested === false &&
        latencyWithRedundantContextData.safety?.skippedPreRouteContext === true &&
        latencyWithRedundantContextData.safety?.startsMicrophone === false &&
        latencyWithRedundantContextData.safety?.usesRealtime === false &&
        latencyWithRedundantContextData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.latency_skip_redundant_context', 'Latency command skips redundant pre-route context', 'voice_latency owns its local audit context even when renderer sends screen/UI flags')
        : fail('voice_command.latency_skip_redundant_context', 'Latency command skips redundant pre-route context', 'voice_latency did not skip redundant screen/UI pre-route context safely', latencyWithRedundantContext.data),
    );

    const directVoiceLatency = await ctx.api('/api/voice/latency?limit=20&auditLimit=500', {
      timeoutMs: 30000,
    });
    const directVoiceLatencyData = directVoiceLatency.data?.latency || {};
    out.push(
      directVoiceLatency.ok &&
        directVoiceLatencyData.version === 1 &&
        typeof directVoiceLatencyData.latency?.avgMs === 'number' &&
        typeof directVoiceLatencyData.latency?.p95Ms === 'number' &&
        directVoiceLatencyData.safety?.readOnly === true &&
        directVoiceLatencyData.safety?.localAuditOnly === true &&
        directVoiceLatencyData.safety?.startsMicrophone === false &&
        directVoiceLatencyData.safety?.usesRealtime === false &&
        directVoiceLatencyData.safety?.capturesScreen === false &&
        directVoiceLatencyData.safety?.readsClipboardText === false &&
        directVoiceLatencyData.safety?.opensTerminal === false &&
        directVoiceLatencyData.safety?.executesActions === false
        ? ok('voice_command.latency_api', 'Voice latency API', `${directVoiceLatencyData.status || '-'} · ${directVoiceLatencyData.latency?.count || 0} sample(s)`)
        : fail('voice_command.latency_api', 'Voice latency API', 'GET /api/voice/latency did not return the read-only local latency contract', directVoiceLatency.data),
    );

    const naturalRealtimeProviderProbe = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '我已经充值好了，帮我重试实时语音 provider probe，先不要开麦',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_realtime_provider_probe',
      },
      timeoutMs: 30000,
    });
    const naturalRealtimeProviderProbeData = naturalRealtimeProviderProbe.data || {};
    const naturalRealtimeProviderProbeRoute = naturalRealtimeProviderProbeData.route || {};
    const naturalRealtimeProviderProbePayload = naturalRealtimeProviderProbeRoute.data?.providerProbeControl || {};
    out.push(
      naturalRealtimeProviderProbe.ok &&
        naturalRealtimeProviderProbeData.ok === true &&
        naturalRealtimeProviderProbeData.executed === false &&
        naturalRealtimeProviderProbeRoute.decision?.localCommand === 'realtime_provider_probe' &&
        naturalRealtimeProviderProbeRoute.localCommand?.intent === 'realtime_provider_probe' &&
        naturalRealtimeProviderProbeRoute.executed === false &&
        naturalRealtimeProviderProbePayload.requestedExecute === false &&
        naturalRealtimeProviderProbePayload.executed === false &&
        naturalRealtimeProviderProbePayload.safety?.previewOnly === true &&
        naturalRealtimeProviderProbePayload.safety?.startsMicrophone === false &&
        naturalRealtimeProviderProbePayload.safety?.capturesAudio === false &&
        naturalRealtimeProviderProbePayload.safety?.storesRawAudio === false &&
        naturalRealtimeProviderProbePayload.safety?.usesRealtimeProvider === false &&
        naturalRealtimeProviderProbeData.safety?.startsMicrophone === false &&
        naturalRealtimeProviderProbeData.safety?.usesRealtime === false &&
        naturalRealtimeProviderProbeData.safety?.callsOpenAIImmediately === false &&
        typeof naturalRealtimeProviderProbeRoute.output === 'string' &&
        naturalRealtimeProviderProbeRoute.output.includes('Realtime provider probe: preview only')
        ? ok('voice_command.natural_realtime_provider_probe_preview', 'Natural Realtime provider probe voice command', '充值好了/重试实时语音 routes to no-mic provider-probe preview without OpenAI call')
        : fail('voice_command.natural_realtime_provider_probe_preview', 'Natural Realtime provider probe voice command', 'natural provider-probe phrase did not preview the local no-mic probe path', naturalRealtimeProviderProbe.data),
    );

    const naturalRealtimeDogfoodPack = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '帮我准备实时语音验收，给我 live drill pack 和下一句。',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_realtime_dogfood_pack',
      },
      timeoutMs: 30000,
    });
    const naturalRealtimeDogfoodPackData = naturalRealtimeDogfoodPack.data || {};
    const realtimeDogfoodPack = naturalRealtimeDogfoodPackData.route?.data?.realtimeDogfoodPack || {};
    out.push(
      naturalRealtimeDogfoodPack.ok &&
        naturalRealtimeDogfoodPackData.ok === true &&
        naturalRealtimeDogfoodPackData.executed === false &&
        naturalRealtimeDogfoodPackData.route?.decision?.localCommand === 'realtime_dogfood_pack' &&
        naturalRealtimeDogfoodPackData.route?.localCommand?.intent === 'realtime_dogfood_pack' &&
        typeof naturalRealtimeDogfoodPackData.route?.output === 'string' &&
        naturalRealtimeDogfoodPackData.route.output.includes('Realtime live drill:') &&
        naturalRealtimeDogfoodPackData.route.output.includes('下一句:') &&
        naturalRealtimeDogfoodPackData.route.output.includes('启动:') &&
        naturalRealtimeDogfoodPackData.route.output.includes('边界:') &&
        realtimeDogfoodPack.kind === 'realtime_live_drill_pack' &&
        realtimeDogfoodPack.manualOnly === true &&
        realtimeDogfoodPack.startsMicrophone === false &&
        realtimeDogfoodPack.triggerStartsMicrophone === true &&
        realtimeDogfoodPack.requiresMicConfirmation === true &&
        realtimeDogfoodPack.readiness?.acceptanceGates >= 20 &&
        realtimeDogfoodPack.safety?.packStartsMicrophone === false &&
        realtimeDogfoodPack.safety?.executeRequiresConfirmMic === true &&
        realtimeDogfoodPack.safety?.desktopPetDiagnostics === false &&
        naturalRealtimeDogfoodPackData.route?.data?.safety?.readOnly === true &&
        naturalRealtimeDogfoodPackData.route?.data?.safety?.startsMicrophone === false &&
        naturalRealtimeDogfoodPackData.route?.data?.safety?.usesRealtime === false &&
        naturalRealtimeDogfoodPackData.route?.data?.safety?.savesArchive === false &&
        naturalRealtimeDogfoodPackData.safety?.startsMicrophone === false &&
        naturalRealtimeDogfoodPackData.safety?.usesRealtime === false &&
        naturalRealtimeDogfoodPackData.safety?.callsOpenAIImmediately === false &&
        naturalRealtimeDogfoodPackData.speech?.dryRun === true
        ? ok('voice_command.natural_realtime_dogfood_pack', 'Natural Realtime dogfood pack voice command', '准备实时语音验收 returns the live drill pack without mic, Realtime, archive save, Terminal, or cloud')
        : fail('voice_command.natural_realtime_dogfood_pack', 'Natural Realtime dogfood pack voice command', 'natural Realtime dogfood pack phrase did not use the local read-only pack path', naturalRealtimeDogfoodPack.data),
    );

    const naturalRealtimeDogfoodArchive = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '保存实时语音验收证据 archive。',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_realtime_dogfood_archive',
      },
      timeoutMs: 30000,
    });
    const naturalRealtimeDogfoodArchiveData = naturalRealtimeDogfoodArchive.data || {};
    const realtimeDogfoodArchive = naturalRealtimeDogfoodArchiveData.route?.data?.realtimeDogfoodArchive || {};
    out.push(
      naturalRealtimeDogfoodArchive.ok &&
        naturalRealtimeDogfoodArchiveData.ok === true &&
        naturalRealtimeDogfoodArchiveData.executed === false &&
        naturalRealtimeDogfoodArchiveData.route?.decision?.localCommand === 'realtime_dogfood_archive' &&
        naturalRealtimeDogfoodArchiveData.route?.localCommand?.intent === 'realtime_dogfood_archive' &&
        naturalRealtimeDogfoodArchiveData.route?.executed === false &&
        typeof naturalRealtimeDogfoodArchiveData.route?.output === 'string' &&
        naturalRealtimeDogfoodArchiveData.route.output.includes('Realtime dogfood archive: preview only') &&
        naturalRealtimeDogfoodArchiveData.route.output.includes('边界:') &&
        realtimeDogfoodArchive.saved === false &&
        realtimeDogfoodArchive.archive?.kind === 'realtime_dogfood_archive' &&
        realtimeDogfoodArchive.archive?.saved === false &&
        realtimeDogfoodArchive.acceptance?.counts?.gates >= 20 &&
        realtimeDogfoodArchive.safety?.startsMicrophone === false &&
        realtimeDogfoodArchive.safety?.usesRealtime === false &&
        realtimeDogfoodArchive.safety?.storesRawAudio === false &&
        realtimeDogfoodArchive.safety?.savesArchive === false &&
        realtimeDogfoodArchive.safety?.writesLocalJson === false &&
        realtimeDogfoodArchive.safety?.opensTerminal === false &&
        naturalRealtimeDogfoodArchiveData.safety?.startsMicrophone === false &&
        naturalRealtimeDogfoodArchiveData.safety?.usesRealtime === false &&
        naturalRealtimeDogfoodArchiveData.safety?.callsOpenAIImmediately === false &&
        naturalRealtimeDogfoodArchiveData.speech?.dryRun === true
        ? ok('voice_command.natural_realtime_dogfood_archive', 'Natural Realtime dogfood archive voice command', '保存实时语音验收证据 previews a local JSON archive without mic, Realtime, archive save, Terminal, or cloud')
        : fail('voice_command.natural_realtime_dogfood_archive', 'Natural Realtime dogfood archive voice command', 'natural Realtime dogfood archive phrase did not use the local preview path', naturalRealtimeDogfoodArchive.data),
    );

    const naturalRealtimeDogfoodScriptCopy = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '把实时语音验收整套脚本复制到剪贴板。',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_realtime_dogfood_script_copy',
      },
      timeoutMs: 30000,
    });
    const naturalRealtimeDogfoodScriptCopyData = naturalRealtimeDogfoodScriptCopy.data || {};
    const promptScriptCopy = naturalRealtimeDogfoodScriptCopyData.route?.data?.promptScriptCopy || {};
    out.push(
      naturalRealtimeDogfoodScriptCopy.ok &&
        naturalRealtimeDogfoodScriptCopyData.ok === true &&
        naturalRealtimeDogfoodScriptCopyData.executed === false &&
        naturalRealtimeDogfoodScriptCopyData.route?.decision?.localCommand === 'realtime_dogfood_script_copy' &&
        naturalRealtimeDogfoodScriptCopyData.route?.localCommand?.intent === 'realtime_dogfood_script_copy' &&
        naturalRealtimeDogfoodScriptCopyData.route?.executed === false &&
        typeof naturalRealtimeDogfoodScriptCopyData.route?.output === 'string' &&
        naturalRealtimeDogfoodScriptCopyData.route.output.includes('Realtime dogfood script copy: preview only') &&
        naturalRealtimeDogfoodScriptCopyData.route.output.includes('脚本预览:') &&
        naturalRealtimeDogfoodScriptCopyData.route.output.includes('边界:') &&
        promptScriptCopy.ok === true &&
        promptScriptCopy.copied === false &&
        promptScriptCopy.wouldCopy === true &&
        Array.isArray(promptScriptCopy.script) &&
        promptScriptCopy.script.length >= 8 &&
        typeof promptScriptCopy.text === 'string' &&
        promptScriptCopy.text.includes('1. ') &&
        promptScriptCopy.safety?.startsMicrophone === false &&
        promptScriptCopy.safety?.usesRealtime === false &&
        promptScriptCopy.safety?.savesArchive === false &&
        promptScriptCopy.safety?.opensTerminal === false &&
        naturalRealtimeDogfoodScriptCopyData.safety?.startsMicrophone === false &&
        naturalRealtimeDogfoodScriptCopyData.safety?.usesRealtime === false &&
        naturalRealtimeDogfoodScriptCopyData.safety?.callsOpenAIImmediately === false &&
        naturalRealtimeDogfoodScriptCopyData.speech?.dryRun === true
        ? ok('voice_command.natural_realtime_dogfood_script_copy', 'Natural Realtime dogfood script copy voice command', '复制实时语音验收整套脚本 previews the full script clipboard write without mic, Realtime, archive save, Terminal, or cloud')
        : fail('voice_command.natural_realtime_dogfood_script_copy', 'Natural Realtime dogfood script copy voice command', 'natural Realtime dogfood script copy phrase did not use the local preview path', naturalRealtimeDogfoodScriptCopy.data),
    );

    const naturalRealtimeDogfoodPromptCopy = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '把实时语音验收下一句复制到剪贴板。',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_realtime_dogfood_prompt_copy',
      },
      timeoutMs: 30000,
    });
    const naturalRealtimeDogfoodPromptCopyData = naturalRealtimeDogfoodPromptCopy.data || {};
    const promptCopy = naturalRealtimeDogfoodPromptCopyData.route?.data?.promptCopy || {};
    out.push(
      naturalRealtimeDogfoodPromptCopy.ok &&
        naturalRealtimeDogfoodPromptCopyData.ok === true &&
        naturalRealtimeDogfoodPromptCopyData.executed === false &&
        naturalRealtimeDogfoodPromptCopyData.route?.decision?.localCommand === 'realtime_dogfood_prompt_copy' &&
        naturalRealtimeDogfoodPromptCopyData.route?.localCommand?.intent === 'realtime_dogfood_prompt_copy' &&
        naturalRealtimeDogfoodPromptCopyData.route?.executed === false &&
        typeof naturalRealtimeDogfoodPromptCopyData.route?.output === 'string' &&
        naturalRealtimeDogfoodPromptCopyData.route.output.includes('Realtime dogfood prompt copy: preview only') &&
        naturalRealtimeDogfoodPromptCopyData.route.output.includes('下一句:') &&
        naturalRealtimeDogfoodPromptCopyData.route.output.includes('边界:') &&
        promptCopy.ok === true &&
        promptCopy.copied === false &&
        promptCopy.wouldCopy === true &&
        typeof promptCopy.text === 'string' &&
        promptCopy.text.length > 0 &&
        promptCopy.safety?.startsMicrophone === false &&
        promptCopy.safety?.usesRealtime === false &&
        promptCopy.safety?.savesArchive === false &&
        promptCopy.safety?.opensTerminal === false &&
        naturalRealtimeDogfoodPromptCopyData.safety?.startsMicrophone === false &&
        naturalRealtimeDogfoodPromptCopyData.safety?.usesRealtime === false &&
        naturalRealtimeDogfoodPromptCopyData.safety?.callsOpenAIImmediately === false &&
        naturalRealtimeDogfoodPromptCopyData.speech?.dryRun === true
        ? ok('voice_command.natural_realtime_dogfood_prompt_copy', 'Natural Realtime dogfood prompt copy voice command', '复制实时语音验收下一句 previews the clipboard write without mic, Realtime, archive save, Terminal, or cloud')
        : fail('voice_command.natural_realtime_dogfood_prompt_copy', 'Natural Realtime dogfood prompt copy voice command', 'natural Realtime dogfood prompt copy phrase did not use the local preview path', naturalRealtimeDogfoodPromptCopy.data),
    );

    const naturalRealtimeDogfoodStatus = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '实时语音验收还差什么，dogfood 证据到哪了？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_realtime_dogfood_status',
      },
      timeoutMs: 30000,
    });
    const naturalRealtimeDogfoodStatusData = naturalRealtimeDogfoodStatus.data || {};
    const realtimeDogfoodPayload = naturalRealtimeDogfoodStatusData.route?.data?.realtimeDogfoodStatus || {};
    out.push(
      naturalRealtimeDogfoodStatus.ok &&
        naturalRealtimeDogfoodStatusData.ok === true &&
        naturalRealtimeDogfoodStatusData.executed === false &&
        naturalRealtimeDogfoodStatusData.route?.decision?.localCommand === 'realtime_dogfood_status' &&
        naturalRealtimeDogfoodStatusData.route?.localCommand?.intent === 'realtime_dogfood_status' &&
        typeof naturalRealtimeDogfoodStatusData.route?.output === 'string' &&
        naturalRealtimeDogfoodStatusData.route.output.includes('Realtime dogfood:') &&
        naturalRealtimeDogfoodStatusData.route.output.includes('下一缺口:') &&
        naturalRealtimeDogfoodStatusData.route.output.includes('边界:') &&
        realtimeDogfoodPayload.acceptance?.counts?.gates >= 20 &&
        realtimeDogfoodPayload.acceptance?.startsMicrophone === false &&
        realtimeDogfoodPayload.evidence?.dogfood?.manualOnly === true &&
        realtimeDogfoodPayload.safety?.readOnly === true &&
        realtimeDogfoodPayload.safety?.startsMicrophone === false &&
        realtimeDogfoodPayload.safety?.usesRealtime === false &&
        realtimeDogfoodPayload.safety?.savesArchive === false &&
        realtimeDogfoodPayload.safety?.callsOpenAI === false &&
        naturalRealtimeDogfoodStatusData.safety?.startsMicrophone === false &&
        naturalRealtimeDogfoodStatusData.safety?.usesRealtime === false &&
        naturalRealtimeDogfoodStatusData.safety?.callsOpenAIImmediately === false &&
        naturalRealtimeDogfoodStatusData.speech?.dryRun === true
        ? ok('voice_command.natural_realtime_dogfood_status', 'Natural Realtime dogfood status voice command', '实时语音验收还差什么 reads local evidence/acceptance without mic, Realtime, archive save, or cloud')
        : fail('voice_command.natural_realtime_dogfood_status', 'Natural Realtime dogfood status voice command', 'natural Realtime dogfood status phrase did not use the local read-only evidence path', naturalRealtimeDogfoodStatus.data),
    );

    const naturalProgress = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '后台现在怎么样',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_progress',
      },
      timeoutMs: 30000,
    });
    const naturalProgressData = naturalProgress.data || {};
    out.push(
      naturalProgress.ok &&
        naturalProgressData.ok === true &&
        naturalProgressData.executed === false &&
        naturalProgressData.route?.decision?.localCommand === 'work_progress' &&
        naturalProgressData.route?.localCommand?.intent === 'work_progress' &&
        typeof naturalProgressData.route?.output === 'string' &&
        naturalProgressData.route.output.includes('下一步') &&
        naturalProgressData.route?.data?.progress?.spokenSummary &&
        typeof naturalProgressData.spokenAck === 'string' &&
        naturalProgressData.spokenAck.length > 0 &&
        naturalProgressData.safety?.startsMicrophone === false &&
        naturalProgressData.safety?.usesRealtime === false &&
        naturalProgressData.safety?.storesRawAudio === false &&
        naturalProgressData.safety?.callsOpenAIImmediately === false &&
        naturalProgressData.speech?.dryRun === true
        ? ok('voice_command.natural_progress', 'Natural progress voice command', '后台现在怎么样 routes to read-only work_progress without cloud/realtime')
        : fail('voice_command.natural_progress', 'Natural progress voice command', 'natural progress phrase did not use the local work_progress fast path', naturalProgress.data),
    );

    const naturalWorkNext = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '继续下一步，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_work_next_preview',
      },
      timeoutMs: 30000,
    });
    const naturalWorkNextData = naturalWorkNext.data || {};
    const naturalWorkNextRoute = naturalWorkNextData.route || {};
    const naturalWorkNextPayload = naturalWorkNextRoute.data?.workNext || {};
    const mainSource = fs.readFileSync('electron/main.cjs', 'utf8');
    const workNextRespectsExecuteFlag =
      mainSource.includes("if (command.intent === 'work_next')") &&
      mainSource.includes('const execute = options.execute === true') &&
      mainSource.includes('workNextAction({') &&
      mainSource.includes('execute,') &&
      !mainSource.includes("const result = await workNextAction({ execute: true, source: 'local_command' });");
    out.push(
      naturalWorkNext.ok &&
        naturalWorkNextData.ok === true &&
        naturalWorkNextData.executed === false &&
        naturalWorkNextRoute.decision?.localCommand === 'work_next' &&
        naturalWorkNextRoute.localCommand?.intent === 'work_next' &&
        naturalWorkNextRoute.executed === false &&
        naturalWorkNextRoute.output?.includes('Work next: preview only') &&
        naturalWorkNextPayload.requestedExecute === false &&
        naturalWorkNextPayload.executed === false &&
        naturalWorkNextPayload.safety?.executesWorkNext === false &&
        naturalWorkNextPayload.safety?.executesActions === false &&
        naturalWorkNextData.safety?.startsMicrophone === false &&
        naturalWorkNextData.safety?.usesRealtime === false &&
        naturalWorkNextData.safety?.callsOpenAIImmediately === false &&
        workNextRespectsExecuteFlag
        ? ok('voice_command.natural_work_next_preview', 'Natural work-next voice command', '继续下一步 routes to work_next preview without executing the candidate')
        : fail('voice_command.natural_work_next_preview', 'Natural work-next voice command', 'natural work-next phrase did not safely preview current work-next', {
          body: naturalWorkNext.data,
          workNextRespectsExecuteFlag,
        }),
    );

    const naturalCapabilities = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '你现在能看到什么，能操作什么，权限开了哪些？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_capabilities',
      },
      timeoutMs: 30000,
    });
    const naturalCapabilitiesData = naturalCapabilities.data || {};
    out.push(
      naturalCapabilities.ok &&
        naturalCapabilitiesData.ok === true &&
        naturalCapabilitiesData.executed === false &&
        naturalCapabilitiesData.route?.decision?.localCommand === 'capability_status' &&
        naturalCapabilitiesData.route?.localCommand?.intent === 'capability_status' &&
        typeof naturalCapabilitiesData.route?.output === 'string' &&
        naturalCapabilitiesData.route.output.includes('能力/权限:') &&
        naturalCapabilitiesData.route.output.includes('主要感知面:') &&
        naturalCapabilitiesData.route.output.includes('主要能力:') &&
        naturalCapabilitiesData.route?.data?.perception?.summary &&
        naturalCapabilitiesData.route?.data?.capabilities?.summary &&
        naturalCapabilitiesData.route?.data?.capabilities?.counts?.total > 0 &&
        naturalCapabilitiesData.safety?.startsMicrophone === false &&
        naturalCapabilitiesData.safety?.usesRealtime === false &&
        naturalCapabilitiesData.safety?.storesRawAudio === false &&
        naturalCapabilitiesData.safety?.callsOpenAIImmediately === false &&
        naturalCapabilitiesData.speech?.dryRun === true
        ? ok('voice_command.natural_capabilities', 'Natural capability voice command', '权限/能看什么 routes to local perception and capability status without cloud/realtime')
        : fail('voice_command.natural_capabilities', 'Natural capability voice command', 'natural capability phrase did not use the local capability_status fast path', naturalCapabilities.data),
    );

    const naturalLearning = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '你从我身上学到了什么，怎么蒸馏我的使用习惯？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_learning_distillation',
      },
      timeoutMs: 30000,
    });
    const naturalLearningData = naturalLearning.data || {};
    out.push(
      naturalLearning.ok &&
        naturalLearningData.ok === true &&
        naturalLearningData.executed === false &&
        naturalLearningData.route?.decision?.localCommand === 'learning_distillation' &&
        naturalLearningData.route?.localCommand?.intent === 'learning_distillation' &&
        typeof naturalLearningData.route?.output === 'string' &&
        naturalLearningData.route.output.includes('本地蒸馏:') &&
        naturalLearningData.route.output.includes('可沉淀候选:') &&
        naturalLearningData.route.output.includes('metadata-only') &&
        naturalLearningData.route.output.includes('不保存记忆') &&
        naturalLearningData.route?.data?.distillation?.kind === 'local_user_distillation' &&
        naturalLearningData.route?.data?.distillation?.privacy?.localOnly === true &&
        naturalLearningData.route?.data?.distillation?.privacy?.metadataOnly === true &&
        naturalLearningData.route?.data?.distillation?.habitCandidates?.policy?.noAutoSave === true &&
        naturalLearningData.safety?.startsMicrophone === false &&
        naturalLearningData.safety?.usesRealtime === false &&
        naturalLearningData.safety?.storesRawAudio === false &&
        naturalLearningData.safety?.callsOpenAIImmediately === false &&
        naturalLearningData.speech?.dryRun === true
        ? ok('voice_command.natural_learning_distillation', 'Natural learning distillation voice command', '学到了什么 routes to local metadata-only user distillation without cloud/realtime')
        : fail('voice_command.natural_learning_distillation', 'Natural learning distillation voice command', 'natural learning phrase did not use the local learning_distillation fast path', naturalLearning.data),
    );

    const naturalPromptSuggestions = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '我现在可以说什么，下一句怎么叫你？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_prompt_suggestions',
      },
      timeoutMs: 30000,
    });
    const naturalPromptSuggestionsData = naturalPromptSuggestions.data || {};
    const naturalPromptPack = naturalPromptSuggestionsData.route?.data?.promptPack || {};
    const naturalPromptInputMode = naturalPromptSuggestionsData.route?.data?.standby?.inputMode || {};
    out.push(
      naturalPromptSuggestions.ok &&
        naturalPromptSuggestionsData.ok === true &&
        naturalPromptSuggestionsData.executed === false &&
        naturalPromptSuggestionsData.route?.decision?.localCommand === 'prompt_suggestions' &&
        naturalPromptSuggestionsData.route?.localCommand?.intent === 'prompt_suggestions' &&
        typeof naturalPromptSuggestionsData.route?.output === 'string' &&
        naturalPromptSuggestionsData.route.output.includes('可以这样叫我:') &&
        naturalPromptSuggestionsData.route.output.includes('建议:') &&
        naturalPromptSuggestionsData.route.output.includes('说话方式: Push-to-talk') &&
        naturalPromptSuggestionsData.route.output.includes('不启动麦克风') &&
        naturalPromptSuggestionsData.route.output.includes('不调用云模型') &&
        typeof naturalPromptPack.nextUtterance === 'string' &&
        naturalPromptPack.nextUtterance.length > 0 &&
        Array.isArray(naturalPromptPack.examples) &&
        naturalPromptSuggestionsData.route?.data?.standby?.version === 1 &&
        naturalPromptInputMode.mode === 'push_to_talk' &&
        naturalPromptInputMode.micDefault === 'push' &&
        naturalPromptSuggestionsData.safety?.startsMicrophone === false &&
        naturalPromptSuggestionsData.safety?.usesRealtime === false &&
        naturalPromptSuggestionsData.safety?.storesRawAudio === false &&
        naturalPromptSuggestionsData.safety?.callsOpenAIImmediately === false &&
        naturalPromptSuggestionsData.speech?.dryRun === true
        ? ok('voice_command.natural_prompt_suggestions', 'Natural prompt-suggestion voice command', '我现在可以说什么 reads the standby prompt pack without cloud/realtime')
        : fail('voice_command.natural_prompt_suggestions', 'Natural prompt-suggestion voice command', 'natural prompt-suggestion phrase did not use the local prompt_suggestions fast path', naturalPromptSuggestions.data),
    );

    const naturalWindowPreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '把你挪到左下角，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_window_preview',
      },
      timeoutMs: 30000,
    });
    const naturalWindowPreviewData = naturalWindowPreview.data || {};
    const naturalWindowPreviewControl = naturalWindowPreviewData.route?.data?.windowControl || {};
    out.push(
      naturalWindowPreview.ok &&
        naturalWindowPreviewData.ok === true &&
        naturalWindowPreviewData.executed === false &&
        naturalWindowPreviewData.route?.decision?.localCommand === 'window_control' &&
        naturalWindowPreviewData.route?.localCommand?.intent === 'window_control' &&
        naturalWindowPreviewControl.executed === false &&
        naturalWindowPreviewControl.target?.corner === 'bottom-left' &&
        naturalWindowPreviewControl.target?.targetPosition?.corner === 'bottom-left' &&
        naturalWindowPreviewControl.safety?.controlsJavisWindowOnly === true &&
        naturalWindowPreviewControl.safety?.mutatesUserFiles === false &&
        typeof naturalWindowPreviewData.route?.output === 'string' &&
        naturalWindowPreviewData.route.output.includes('窗口控制: preview only') &&
        naturalWindowPreviewData.safety?.startsMicrophone === false &&
        naturalWindowPreviewData.safety?.usesRealtime === false &&
        naturalWindowPreviewData.safety?.storesRawAudio === false &&
        naturalWindowPreviewData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_window_preview', 'Natural pet window preview voice command', '把你挪到左下角 routes to JAVIS-only window_control preview')
        : fail('voice_command.natural_window_preview', 'Natural pet window preview voice command', 'natural pet/window phrase did not use the safe window_control preview path', naturalWindowPreview.data),
    );

    const naturalWindowExecute = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '回到刘海并变小',
        execute: true,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_window_execute',
      },
      timeoutMs: 30000,
    });
    const naturalWindowExecuteData = naturalWindowExecute.data || {};
    const naturalWindowExecuteControl = naturalWindowExecuteData.route?.data?.windowControl || {};
    await ctx.api('/api/window/mode', {
      method: 'POST',
      body: {
        mode: 'pet',
        focus: false,
      },
      timeoutMs: 10000,
    });
    await ctx.api('/api/window/park', {
      method: 'POST',
      body: {
        corner: 'notch',
      },
      timeoutMs: 10000,
    });
    out.push(
      naturalWindowExecute.ok &&
        naturalWindowExecuteData.ok === true &&
        naturalWindowExecuteData.requestedExecute === true &&
        naturalWindowExecuteData.executed === true &&
        naturalWindowExecuteData.route?.decision?.localCommand === 'window_control' &&
        naturalWindowExecuteData.route?.localCommand?.intent === 'window_control' &&
        naturalWindowExecuteControl.executed === true &&
        naturalWindowExecuteControl.target?.mode === 'pet' &&
        naturalWindowExecuteControl.target?.corner === 'notch' &&
        naturalWindowExecuteControl.after?.mode === 'pet' &&
        naturalWindowExecuteControl.after?.parkCorner === 'notch' &&
        naturalWindowExecuteControl.safety?.controlsJavisWindowOnly === true &&
        naturalWindowExecuteControl.safety?.controlsOtherApps === false &&
        naturalWindowExecuteControl.safety?.mutatesUserFiles === false &&
        typeof naturalWindowExecuteData.route?.output === 'string' &&
        naturalWindowExecuteData.route.output.includes('窗口控制: executed') &&
        naturalWindowExecuteData.safety?.startsMicrophone === false &&
        naturalWindowExecuteData.safety?.usesRealtime === false &&
        naturalWindowExecuteData.safety?.storesRawAudio === false &&
        naturalWindowExecuteData.safety?.callsOpenAIImmediately === false &&
        naturalWindowExecuteData.safety?.executesLocalCommand === true
        ? ok('voice_command.natural_window_execute', 'Natural pet window execute voice command', '回到刘海并变小 executes only JAVIS window park/mode control and restores pet state')
        : fail('voice_command.natural_window_execute', 'Natural pet window execute voice command', 'natural pet/window execute phrase did not stay within JAVIS-only window control', naturalWindowExecute.data),
    );

    const naturalInboxPreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '记一下：明天检查 JAVIS 浏览器接管体验',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_inbox_preview',
      },
      timeoutMs: 30000,
    });
    const naturalInboxPreviewData = naturalInboxPreview.data || {};
    const naturalInboxPreviewCapture = naturalInboxPreviewData.route?.data?.inboxCapture || {};
    out.push(
      naturalInboxPreview.ok &&
        naturalInboxPreviewData.ok === true &&
        naturalInboxPreviewData.executed === false &&
        naturalInboxPreviewData.route?.decision?.localCommand === 'capture_text' &&
        naturalInboxPreviewData.route?.localCommand?.intent === 'capture_text' &&
        naturalInboxPreviewCapture.previewOnly === true &&
        naturalInboxPreviewCapture.executed === false &&
        naturalInboxPreviewCapture.safety?.writesInbox === false &&
        naturalInboxPreviewCapture.safety?.writesMemory === false &&
        naturalInboxPreviewCapture.bodyPreview?.includes('JAVIS 浏览器接管体验') &&
        !naturalInboxPreviewCapture.item?.id &&
        typeof naturalInboxPreviewData.route?.output === 'string' &&
        naturalInboxPreviewData.route.output.includes('Inbox capture: preview only') &&
        naturalInboxPreviewData.safety?.startsMicrophone === false &&
        naturalInboxPreviewData.safety?.usesRealtime === false &&
        naturalInboxPreviewData.safety?.storesRawAudio === false &&
        naturalInboxPreviewData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_inbox_preview', 'Natural Inbox capture preview voice command', '记一下 routes to preview-only local Inbox capture without writing memory/inbox')
        : fail('voice_command.natural_inbox_preview', 'Natural Inbox capture preview voice command', 'natural note-taking phrase did not use preview-only capture_text', naturalInboxPreview.data),
    );

    const naturalInboxExecute = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '记一下：eval 临时 Inbox capture，测试后删除',
        execute: true,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_inbox_execute',
      },
      timeoutMs: 30000,
    });
    const naturalInboxExecuteData = naturalInboxExecute.data || {};
    const naturalInboxExecuteCapture = naturalInboxExecuteData.route?.data?.inboxCapture || {};
    const naturalInboxExecuteItemId = naturalInboxExecuteCapture.item?.id || naturalInboxExecuteData.route?.data?.item?.id || '';
    let naturalInboxCleanupOk = false;
    if (naturalInboxExecuteItemId) {
      const cleanup = await ctx.api(`/api/inbox/${encodeURIComponent(naturalInboxExecuteItemId)}`, {
        method: 'DELETE',
        retries: 0,
        timeoutMs: 10000,
      });
      naturalInboxCleanupOk = cleanup.ok === true;
    }
    out.push(
      naturalInboxExecute.ok &&
        naturalInboxExecuteData.ok === true &&
        naturalInboxExecuteData.requestedExecute === true &&
        naturalInboxExecuteData.executed === true &&
        naturalInboxExecuteData.route?.decision?.localCommand === 'capture_text' &&
        naturalInboxExecuteData.route?.localCommand?.intent === 'capture_text' &&
        naturalInboxExecuteCapture.previewOnly === false &&
        naturalInboxExecuteCapture.executed === true &&
        naturalInboxExecuteCapture.safety?.writesInbox === true &&
        naturalInboxExecuteCapture.safety?.writesMemory === false &&
        naturalInboxExecuteCapture.safety?.readsClipboardText === false &&
        naturalInboxExecuteItemId &&
        naturalInboxCleanupOk &&
        typeof naturalInboxExecuteData.route?.output === 'string' &&
        naturalInboxExecuteData.route.output.includes('Inbox capture: saved') &&
        naturalInboxExecuteData.safety?.startsMicrophone === false &&
        naturalInboxExecuteData.safety?.usesRealtime === false &&
        naturalInboxExecuteData.safety?.storesRawAudio === false &&
        naturalInboxExecuteData.safety?.callsOpenAIImmediately === false &&
        naturalInboxExecuteData.safety?.executesLocalCommand === true
        ? ok('voice_command.natural_inbox_execute', 'Natural Inbox capture execute voice command', '记一下 with execute writes one local Inbox item and cleanup deletes the eval item')
        : fail('voice_command.natural_inbox_execute', 'Natural Inbox capture execute voice command', 'natural note-taking execute phrase did not create a cleanup-safe local Inbox item', {
            response: naturalInboxExecute.data,
            itemId: naturalInboxExecuteItemId,
            cleanupOk: naturalInboxCleanupOk,
        }),
    );

    const naturalKeepAwakePreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '今晚别睡，保持后台运行，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_keep_awake_preview',
      },
      timeoutMs: 30000,
    });
    const naturalKeepAwakePreviewData = naturalKeepAwakePreview.data || {};
    const naturalKeepAwakePreviewControl = naturalKeepAwakePreviewData.route?.data?.keepAwakeControl || {};
    out.push(
      naturalKeepAwakePreview.ok &&
        naturalKeepAwakePreviewData.ok === true &&
        naturalKeepAwakePreviewData.executed === false &&
        naturalKeepAwakePreviewData.route?.decision?.localCommand === 'keep_awake' &&
        naturalKeepAwakePreviewData.route?.localCommand?.intent === 'keep_awake' &&
        naturalKeepAwakePreviewControl.action === 'start' &&
        naturalKeepAwakePreviewControl.preview === true &&
        naturalKeepAwakePreviewControl.executed === false &&
        naturalKeepAwakePreviewControl.safety?.changesLaunchdJob === true &&
        naturalKeepAwakePreviewControl.safety?.startsMicrophone === false &&
        naturalKeepAwakePreviewControl.safety?.usesRealtime === false &&
        typeof naturalKeepAwakePreviewData.route?.output === 'string' &&
        naturalKeepAwakePreviewData.route.output.includes('Keep-awake: start preview') &&
        naturalKeepAwakePreviewData.safety?.startsMicrophone === false &&
        naturalKeepAwakePreviewData.safety?.usesRealtime === false &&
        naturalKeepAwakePreviewData.safety?.storesRawAudio === false &&
        naturalKeepAwakePreviewData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_keep_awake_preview', 'Natural keep-awake preview voice command', '今晚别睡 routes to no-side-effect keep_awake start preview')
        : fail('voice_command.natural_keep_awake_preview', 'Natural keep-awake preview voice command', 'natural keep-awake phrase did not use preview-only keep_awake start', naturalKeepAwakePreview.data),
    );

    const naturalKeepAwakeExecute = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '今晚别睡，保持后台运行',
        execute: true,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_keep_awake_execute',
      },
      timeoutMs: 30000,
    });
    const naturalKeepAwakeExecuteData = naturalKeepAwakeExecute.data || {};
    const naturalKeepAwakeExecuteControl = naturalKeepAwakeExecuteData.route?.data?.keepAwakeControl || {};
    out.push(
      naturalKeepAwakeExecute.ok &&
        naturalKeepAwakeExecuteData.ok === true &&
        naturalKeepAwakeExecuteData.requestedExecute === true &&
        naturalKeepAwakeExecuteData.route?.decision?.localCommand === 'keep_awake' &&
        naturalKeepAwakeExecuteData.route?.localCommand?.intent === 'keep_awake' &&
        naturalKeepAwakeExecuteControl.action === 'start' &&
        naturalKeepAwakeExecuteControl.preview === false &&
        (naturalKeepAwakeExecuteControl.executed === true || naturalKeepAwakeExecuteControl.alreadyRunning === true) &&
        naturalKeepAwakeExecuteControl.running === true &&
        naturalKeepAwakeExecuteControl.screenMaySleep === true &&
        naturalKeepAwakeExecuteControl.safety?.changesLaunchdJob === true &&
        naturalKeepAwakeExecuteControl.safety?.startsMicrophone === false &&
        naturalKeepAwakeExecuteControl.safety?.usesRealtime === false &&
        typeof naturalKeepAwakeExecuteData.route?.output === 'string' &&
        (naturalKeepAwakeExecuteData.route.output.includes('start executed') || naturalKeepAwakeExecuteData.route.output.includes('already running')) &&
        naturalKeepAwakeExecuteData.safety?.startsMicrophone === false &&
        naturalKeepAwakeExecuteData.safety?.usesRealtime === false &&
        naturalKeepAwakeExecuteData.safety?.storesRawAudio === false &&
        naturalKeepAwakeExecuteData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_keep_awake_execute', 'Natural keep-awake execute voice command', '今晚别睡 starts or reuses JAVIS-managed keep-awake without mic/realtime')
        : fail('voice_command.natural_keep_awake_execute', 'Natural keep-awake execute voice command', 'natural keep-awake execute phrase did not start/reuse JAVIS-managed keep-awake safely', naturalKeepAwakeExecute.data),
    );

    const naturalKeepAwakeStopPreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '可以睡了，停止防睡眠，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_keep_awake_stop_preview',
      },
      timeoutMs: 30000,
    });
    const naturalKeepAwakeStopPreviewData = naturalKeepAwakeStopPreview.data || {};
    const naturalKeepAwakeStopPreviewControl = naturalKeepAwakeStopPreviewData.route?.data?.keepAwakeControl || {};
    out.push(
      naturalKeepAwakeStopPreview.ok &&
        naturalKeepAwakeStopPreviewData.ok === true &&
        naturalKeepAwakeStopPreviewData.executed === false &&
        naturalKeepAwakeStopPreviewData.route?.decision?.localCommand === 'keep_awake' &&
        naturalKeepAwakeStopPreviewData.route?.localCommand?.intent === 'keep_awake' &&
        naturalKeepAwakeStopPreviewControl.action === 'stop' &&
        naturalKeepAwakeStopPreviewControl.preview === true &&
        naturalKeepAwakeStopPreviewControl.executed === false &&
        naturalKeepAwakeStopPreviewControl.safety?.changesLaunchdJob === true &&
        naturalKeepAwakeStopPreviewControl.safety?.startsMicrophone === false &&
        naturalKeepAwakeStopPreviewControl.safety?.usesRealtime === false &&
        typeof naturalKeepAwakeStopPreviewData.route?.output === 'string' &&
        naturalKeepAwakeStopPreviewData.route.output.includes('Keep-awake: stop preview') &&
        naturalKeepAwakeStopPreviewData.safety?.startsMicrophone === false &&
        naturalKeepAwakeStopPreviewData.safety?.usesRealtime === false &&
        naturalKeepAwakeStopPreviewData.safety?.storesRawAudio === false &&
        naturalKeepAwakeStopPreviewData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_keep_awake_stop_preview', 'Natural keep-awake stop preview voice command', '可以睡了 routes to stop preview without disabling current keep-awake')
        : fail('voice_command.natural_keep_awake_stop_preview', 'Natural keep-awake stop preview voice command', 'natural keep-awake stop phrase did not use preview-only stop gate', naturalKeepAwakeStopPreview.data),
    );

    const naturalBrowserReady = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '浏览器准备好了吗，默认不要问我哪个窗口',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_browser_readiness',
      },
      timeoutMs: 30000,
    });
    const naturalBrowserReadyData = naturalBrowserReady.data || {};
    out.push(
      naturalBrowserReady.ok &&
        naturalBrowserReadyData.ok === true &&
        naturalBrowserReadyData.executed === false &&
        naturalBrowserReadyData.route?.decision?.localCommand === 'browser_readiness' &&
        naturalBrowserReadyData.route?.localCommand?.intent === 'browser_readiness' &&
        naturalBrowserReadyData.route?.data?.readiness?.version === 1 &&
        naturalBrowserReadyData.route?.data?.readiness?.defaultTarget?.asksWhichWindow === false &&
        typeof naturalBrowserReadyData.route?.output === 'string' &&
        naturalBrowserReadyData.route.output.includes('浏览器状态:') &&
        naturalBrowserReadyData.route.output.includes('不询问窗口=yes') &&
        naturalBrowserReadyData.safety?.startsMicrophone === false &&
        naturalBrowserReadyData.safety?.usesRealtime === false &&
        naturalBrowserReadyData.safety?.storesRawAudio === false &&
        naturalBrowserReadyData.safety?.callsOpenAIImmediately === false &&
        naturalBrowserReadyData.speech?.dryRun === true
        ? ok('voice_command.natural_browser_readiness', 'Natural browser readiness voice command', '浏览器准备好了吗 routes to read-only browser_readiness without cloud/realtime')
        : fail('voice_command.natural_browser_readiness', 'Natural browser readiness voice command', 'natural browser readiness phrase did not use the local browser_readiness fast path', naturalBrowserReady.data),
    );

    const naturalBrowserRecovery = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '打开一个可以操作的浏览器，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_browser_recovery',
      },
      timeoutMs: 30000,
    });
    const naturalBrowserRecoveryData = naturalBrowserRecovery.data || {};
    const naturalBrowserRecoveryRoute = naturalBrowserRecoveryData.route || {};
    const naturalBrowserRecoveryPayload = naturalBrowserRecoveryRoute.data?.browserRecovery || {};
    out.push(
      naturalBrowserRecovery.ok &&
        naturalBrowserRecoveryData.ok === true &&
        naturalBrowserRecoveryData.executed === false &&
        naturalBrowserRecoveryRoute.decision?.localCommand === 'browser_recovery' &&
        naturalBrowserRecoveryRoute.localCommand?.intent === 'browser_recovery' &&
        naturalBrowserRecoveryRoute.executed === false &&
        naturalBrowserRecoveryPayload.requestedExecute === false &&
        naturalBrowserRecoveryPayload.executed === false &&
        naturalBrowserRecoveryPayload.safety?.previewOnly === true &&
        naturalBrowserRecoveryPayload.safety?.opensSupportedBrowser === false &&
        naturalBrowserRecoveryPayload.safety?.startsMicrophone === false &&
        naturalBrowserRecoveryPayload.safety?.usesRealtime === false &&
        naturalBrowserRecoveryPayload.safety?.opensTerminal === false &&
        naturalBrowserRecoveryData.safety?.startsMicrophone === false &&
        naturalBrowserRecoveryData.safety?.usesRealtime === false &&
        naturalBrowserRecoveryData.safety?.callsOpenAIImmediately === false &&
        typeof naturalBrowserRecoveryRoute.output === 'string' &&
        naturalBrowserRecoveryRoute.output.includes('Browser recovery: preview only')
        ? ok('voice_command.natural_browser_recovery_preview', 'Natural browser recovery voice command', '打开可操作浏览器 routes to browser_recovery preview without opening browser, mic, Realtime, or Terminal')
        : fail('voice_command.natural_browser_recovery_preview', 'Natural browser recovery voice command', 'natural browser recovery phrase did not safely preview browser recovery', naturalBrowserRecovery.data),
    );

    const naturalBrowserPage = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '读一下当前网页，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_browser_page',
      },
      timeoutMs: 30000,
    });
    const naturalBrowserPageData = naturalBrowserPage.data || {};
    out.push(
      naturalBrowserPage.ok &&
        naturalBrowserPageData.ok === true &&
        naturalBrowserPageData.executed === false &&
        naturalBrowserPageData.route?.decision?.localCommand === 'browser_page' &&
        naturalBrowserPageData.route?.localCommand?.intent === 'browser_page' &&
        naturalBrowserPageData.route?.data?.page &&
        typeof naturalBrowserPageData.route?.output === 'string' &&
        naturalBrowserPageData.route.output.includes('当前网页:') &&
        naturalBrowserPageData.route.output.includes('只读当前网页') &&
        naturalBrowserPageData.safety?.startsMicrophone === false &&
        naturalBrowserPageData.safety?.usesRealtime === false &&
        naturalBrowserPageData.safety?.storesRawAudio === false &&
        naturalBrowserPageData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_browser_page', 'Natural browser page voice command', '读当前网页 routes to read-only browser_page without cloud/realtime')
        : fail('voice_command.natural_browser_page', 'Natural browser page voice command', 'natural browser page phrase did not use the local browser_page fast path', naturalBrowserPage.data),
    );

    const naturalBrowserDom = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '当前网页有哪些按钮和输入框？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_browser_dom',
      },
      timeoutMs: 30000,
    });
    const naturalBrowserDomData = naturalBrowserDom.data || {};
    out.push(
      naturalBrowserDom.ok &&
        naturalBrowserDomData.ok === true &&
        naturalBrowserDomData.executed === false &&
        naturalBrowserDomData.route?.decision?.localCommand === 'browser_dom' &&
        naturalBrowserDomData.route?.localCommand?.intent === 'browser_dom' &&
        naturalBrowserDomData.route?.data?.dom &&
        typeof naturalBrowserDomData.route?.output === 'string' &&
        naturalBrowserDomData.route.output.includes('网页控件:') &&
        naturalBrowserDomData.route.output.includes('这里只读可见控件') &&
        naturalBrowserDomData.safety?.startsMicrophone === false &&
        naturalBrowserDomData.safety?.usesRealtime === false &&
        naturalBrowserDomData.safety?.storesRawAudio === false &&
        naturalBrowserDomData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_browser_dom', 'Natural browser DOM voice command', '当前网页有哪些按钮 routes to read-only browser_dom without cloud/realtime')
        : fail('voice_command.natural_browser_dom', 'Natural browser DOM voice command', 'natural browser DOM phrase did not use the local browser_dom fast path', naturalBrowserDom.data),
    );

    const naturalBrowserActSearch = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '帮我在浏览器搜索 JAVIS spend guard',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_browser_act_search',
      },
      timeoutMs: 30000,
    });
    const naturalBrowserActSearchData = naturalBrowserActSearch.data || {};
    const naturalBrowserActSearchRoute = naturalBrowserActSearchData.route || {};
    const naturalBrowserActSearchPayload = naturalBrowserActSearchRoute.data?.browserWorkflow || {};
    const naturalBrowserActSearchResult = naturalBrowserActSearchRoute.data?.result || {};
    out.push(
      naturalBrowserActSearch.ok &&
        naturalBrowserActSearchData.ok === true &&
        naturalBrowserActSearchData.executed === false &&
        naturalBrowserActSearchRoute.decision?.localCommand === 'browser_workflow' &&
        naturalBrowserActSearchRoute.localCommand?.intent === 'browser_workflow' &&
        naturalBrowserActSearchRoute.localCommand?.args?.intent === 'act' &&
        naturalBrowserActSearchPayload.requestedExecute === false &&
        naturalBrowserActSearchPayload.executed === false &&
        naturalBrowserActSearchPayload.intent === 'act' &&
        naturalBrowserActSearchPayload.safety?.previewOnly === true &&
        naturalBrowserActSearchPayload.safety?.executesBrowserWorkflow === false &&
        naturalBrowserActSearchPayload.safety?.executesBrowserAction === false &&
        naturalBrowserActSearchResult.plan?.source === 'local_fallback' &&
        naturalBrowserActSearchResult.plan?.plannerError === '' &&
        naturalBrowserActSearchResult.plan?.steps?.[0]?.action === 'search' &&
        naturalBrowserActSearchResult.plan?.steps?.[0]?.query === 'JAVIS spend guard' &&
        naturalBrowserActSearchResult.results?.[0]?.status === 'previewed' &&
        naturalBrowserActSearchData.safety?.startsMicrophone === false &&
        naturalBrowserActSearchData.safety?.usesRealtime === false &&
        naturalBrowserActSearchData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_browser_act_search', 'Natural browser act-search voice command', '浏览器搜索 routes to local browser act fallback without browser execution or cloud')
        : fail('voice_command.natural_browser_act_search', 'Natural browser act-search voice command', 'natural browser search did not use local act fallback safely', naturalBrowserActSearch.data),
    );

    const naturalBrowserWorkflow = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '提取当前网页行动项，先预览，不要点击',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_browser_workflow_preview',
      },
      timeoutMs: 30000,
    });
    const naturalBrowserWorkflowData = naturalBrowserWorkflow.data || {};
    const naturalBrowserWorkflowRoute = naturalBrowserWorkflowData.route || {};
    const naturalBrowserWorkflowPayload = naturalBrowserWorkflowRoute.data?.browserWorkflow || {};
    const mainSourceForBrowserWorkflow = fs.readFileSync('electron/main.cjs', 'utf8');
    const browserWorkflowRespectsExecuteFlag =
      mainSourceForBrowserWorkflow.includes("if (command.intent === 'browser_workflow')") &&
      mainSourceForBrowserWorkflow.includes('const execute = options.execute === true') &&
      mainSourceForBrowserWorkflow.includes('runBrowserWorkflow({') &&
      mainSourceForBrowserWorkflow.includes('execute,') &&
      !mainSourceForBrowserWorkflow.includes("runBrowserWorkflow({ ...(command.args || {}), execute: true");
    out.push(
      naturalBrowserWorkflow.ok &&
        naturalBrowserWorkflowData.ok === true &&
        naturalBrowserWorkflowData.executed === false &&
        naturalBrowserWorkflowRoute.decision?.localCommand === 'browser_workflow' &&
        naturalBrowserWorkflowRoute.localCommand?.intent === 'browser_workflow' &&
        naturalBrowserWorkflowRoute.executed === false &&
        naturalBrowserWorkflowRoute.output?.includes('Browser workflow: preview only') &&
        naturalBrowserWorkflowPayload.requestedExecute === false &&
        naturalBrowserWorkflowPayload.executed === false &&
        naturalBrowserWorkflowPayload.intent === 'extract_actions' &&
        naturalBrowserWorkflowPayload.safety?.previewOnly === true &&
        naturalBrowserWorkflowPayload.safety?.executesBrowserWorkflow === false &&
        naturalBrowserWorkflowPayload.safety?.executesBrowserAction === false &&
        naturalBrowserWorkflowData.safety?.startsMicrophone === false &&
        naturalBrowserWorkflowData.safety?.usesRealtime === false &&
        naturalBrowserWorkflowData.safety?.callsOpenAIImmediately === false &&
        browserWorkflowRespectsExecuteFlag
        ? ok('voice_command.natural_browser_workflow_preview', 'Natural browser workflow voice command', '提取当前网页行动项 routes to browser_workflow preview without clicking or cloud/realtime')
        : fail('voice_command.natural_browser_workflow_preview', 'Natural browser workflow voice command', 'natural browser workflow phrase did not safely preview browser workflow', {
          body: naturalBrowserWorkflow.data,
          browserWorkflowRespectsExecuteFlag,
        }),
    );

    const naturalObserveNow = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '看一下当前屏幕和窗口，先不要操作',
        execute: false,
        includeScreen: true,
        includeAccessibility: true,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_observe_now',
      },
      timeoutMs: 30000,
    });
    const naturalObserveNowData = naturalObserveNow.data || {};
    const naturalObserveNowRoute = naturalObserveNowData.route || {};
    const naturalObserveObservation = naturalObserveNowRoute.data?.observation || {};
    const naturalObserveClipboard = naturalObserveObservation.mac?.clipboard || {};
    const naturalObserveHidesClipboard =
      naturalObserveObservation.safety?.includesClipboardText === false &&
      !('text' in naturalObserveClipboard) &&
      !String(naturalObserveClipboard.preview || '').trim() &&
      (!naturalObserveClipboard.hasText || naturalObserveNowRoute.output.includes('content hidden'));
    out.push(
      naturalObserveNow.ok &&
        naturalObserveNowData.ok === true &&
        naturalObserveNowData.executed === false &&
        naturalObserveNowRoute.decision?.localCommand === 'observe_now' &&
        naturalObserveNowRoute.localCommand?.intent === 'observe_now' &&
        naturalObserveNowData.context?.skippedPreRouteContext === true &&
        naturalObserveNowData.context?.localCommand === 'observe_now' &&
        naturalObserveNowData.context?.includeScreenRequested === true &&
        naturalObserveNowData.context?.includeAccessibilityRequested === true &&
        naturalObserveNowData.context?.includesScreenImage === false &&
        naturalObserveNowData.context?.includesAccessibilityNodes === false &&
        (naturalObserveObservation.accessibility === null || naturalObserveObservation.accessibility?.available !== true) &&
        naturalObserveNowRoute.executed === false &&
        naturalObserveObservation.ok === true &&
        typeof naturalObserveNowRoute.output === 'string' &&
        naturalObserveNowRoute.output.includes('当前 App:') &&
        naturalObserveNowRoute.output.includes('屏幕:') &&
        naturalObserveNowRoute.output.includes('任务:') &&
        naturalObserveHidesClipboard &&
        naturalObserveNowData.safety?.startsMicrophone === false &&
        naturalObserveNowData.safety?.usesRealtime === false &&
        naturalObserveNowData.safety?.storesRawAudio === false &&
        naturalObserveNowData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_observe_now', 'Natural observe-now voice command', '看一下当前屏幕 routes to lightweight observe_now, skips duplicate pre-route screen/UI context, and avoids action, clipboard text, cloud, mic, or Realtime')
        : fail('voice_command.natural_observe_now', 'Natural observe-now voice command', 'natural observe phrase did not run the local observe_now preview path', naturalObserveNow.data),
    );

    const naturalAppUi = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '当前应用有哪些控件？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_app_ui',
      },
      timeoutMs: 30000,
    });
    const naturalAppUiData = naturalAppUi.data || {};
    out.push(
      naturalAppUi.ok &&
        naturalAppUiData.ok === true &&
        naturalAppUiData.executed === false &&
        naturalAppUiData.route?.decision?.localCommand === 'app_ui' &&
        naturalAppUiData.route?.localCommand?.intent === 'app_ui' &&
        naturalAppUiData.route?.data?.tree &&
        !('nodes' in naturalAppUiData.route.data.tree) &&
        typeof naturalAppUiData.route.data.tree.nodeCount === 'number' &&
        typeof naturalAppUiData.route?.output === 'string' &&
        naturalAppUiData.route.output.includes('当前应用 UI:') &&
        naturalAppUiData.route.output.includes('这里只读 Accessibility outline') &&
        naturalAppUiData.safety?.startsMicrophone === false &&
        naturalAppUiData.safety?.usesRealtime === false &&
        naturalAppUiData.safety?.storesRawAudio === false &&
        naturalAppUiData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_app_ui', 'Natural current-app UI voice command', '当前应用有哪些控件 routes to read-only app_ui without cloud/realtime or full AX nodes')
        : fail('voice_command.natural_app_ui', 'Natural current-app UI voice command', 'natural current-app UI phrase did not use the local app_ui fast path', naturalAppUi.data),
    );

    const naturalAppUiCached = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '当前窗口有哪些按钮？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_app_ui_cached',
      },
      timeoutMs: 30000,
    });
    const naturalAppUiCachedData = naturalAppUiCached.data || {};
    out.push(
      naturalAppUiCached.ok &&
        naturalAppUiCachedData.ok === true &&
        naturalAppUiCachedData.executed === false &&
        naturalAppUiCachedData.route?.decision?.localCommand === 'app_ui' &&
        naturalAppUiCachedData.route?.localCommand?.intent === 'app_ui' &&
        naturalAppUiCachedData.route?.data?.tree?.cached === true &&
        typeof naturalAppUiCachedData.route.data.tree.cacheAgeMs === 'number' &&
        !('nodes' in naturalAppUiCachedData.route.data.tree) &&
        typeof naturalAppUiCachedData.route?.output === 'string' &&
        naturalAppUiCachedData.route.output.includes('cache=hit') &&
        naturalAppUiCachedData.safety?.startsMicrophone === false &&
        naturalAppUiCachedData.safety?.usesRealtime === false &&
        naturalAppUiCachedData.safety?.storesRawAudio === false &&
        naturalAppUiCachedData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_app_ui_cached', 'Natural current-app UI cache hit', `second app_ui request reused cached AX outline in ${naturalAppUiCachedData.route.data.tree.cacheAgeMs}ms`)
        : fail('voice_command.natural_app_ui_cached', 'Natural current-app UI cache hit', 'second current-app UI phrase did not reuse the bounded AX cache', naturalAppUiCached.data),
    );

    const ambientPrewarm = await ctx.api('/api/ambient/sample', {
      method: 'POST',
      body: {
        source: 'eval_voice_command_app_ui_prewarm',
        prewarmAppUi: true,
        waitForPrewarm: true,
      },
      timeoutMs: 30000,
    });
    const ambientPrewarmState = ambientPrewarm.data?.ambient?.appUiPrewarm || {};
    const ambientPrewarmCache = ambientPrewarmState.cache || {};
    out.push(
      ambientPrewarm.ok &&
        ambientPrewarm.data?.ok === true &&
        ambientPrewarmState.enabled === true &&
        ['cached', 'warmed'].includes(ambientPrewarmState.lastStatus) &&
        typeof ambientPrewarmState.lastNodeCount === 'number' &&
        typeof ambientPrewarmCache.ageMs === 'number' &&
        !('nodes' in ambientPrewarmCache)
        ? ok('voice_command.ambient_app_ui_prewarm', 'Ambient current-app UI prewarm', `${ambientPrewarmState.lastStatus} · app=${ambientPrewarmState.lastApp || '-'} · nodes=${ambientPrewarmState.lastNodeCount}`)
        : fail('voice_command.ambient_app_ui_prewarm', 'Ambient current-app UI prewarm', 'ambient sample did not expose a bounded current-app UI prewarm cache', ambientPrewarm.data),
    );

    const naturalAppUiAfterPrewarm = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '这个界面能点什么？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_app_ui_after_prewarm',
      },
      timeoutMs: 30000,
    });
    const naturalAppUiAfterPrewarmData = naturalAppUiAfterPrewarm.data || {};
    out.push(
      naturalAppUiAfterPrewarm.ok &&
        naturalAppUiAfterPrewarmData.ok === true &&
        naturalAppUiAfterPrewarmData.executed === false &&
        naturalAppUiAfterPrewarmData.route?.decision?.localCommand === 'app_ui' &&
        naturalAppUiAfterPrewarmData.route?.localCommand?.intent === 'app_ui' &&
        naturalAppUiAfterPrewarmData.route?.data?.tree?.cached === true &&
        !('nodes' in naturalAppUiAfterPrewarmData.route.data.tree) &&
        typeof naturalAppUiAfterPrewarmData.route?.output === 'string' &&
        naturalAppUiAfterPrewarmData.route.output.includes('cache=hit') &&
        naturalAppUiAfterPrewarmData.safety?.startsMicrophone === false &&
        naturalAppUiAfterPrewarmData.safety?.usesRealtime === false &&
        naturalAppUiAfterPrewarmData.safety?.storesRawAudio === false &&
        naturalAppUiAfterPrewarmData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_app_ui_after_prewarm', 'Natural current-app UI after ambient prewarm', '这个界面能点什么 uses the prewarmed read-only app_ui cache')
        : fail('voice_command.natural_app_ui_after_prewarm', 'Natural current-app UI after ambient prewarm', 'natural app UI phrase did not use the prewarmed app_ui cache', naturalAppUiAfterPrewarm.data),
    );

    const naturalAppUiStatus = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '界面预热好了吗？',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_app_ui_status',
      },
      timeoutMs: 30000,
    });
    const naturalAppUiStatusData = naturalAppUiStatus.data || {};
    out.push(
      naturalAppUiStatus.ok &&
        naturalAppUiStatusData.ok === true &&
        naturalAppUiStatusData.executed === false &&
        naturalAppUiStatusData.route?.decision?.localCommand === 'app_ui_status' &&
        naturalAppUiStatusData.route?.localCommand?.intent === 'app_ui_status' &&
        naturalAppUiStatusData.route?.data?.prewarm?.cache &&
        !('nodes' in naturalAppUiStatusData.route.data.prewarm.cache) &&
        typeof naturalAppUiStatusData.route?.output === 'string' &&
        naturalAppUiStatusData.route.output.includes('UI 预热:') &&
        naturalAppUiStatusData.route.output.includes('这里只读内存里的 UI 预热/缓存元数据') &&
        naturalAppUiStatusData.safety?.startsMicrophone === false &&
        naturalAppUiStatusData.safety?.usesRealtime === false &&
        naturalAppUiStatusData.safety?.storesRawAudio === false &&
        naturalAppUiStatusData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_app_ui_status', 'Natural current-app UI status voice command', '界面预热好了吗 routes to read-only app_ui_status metadata without cloud/realtime')
        : fail('voice_command.natural_app_ui_status', 'Natural current-app UI status voice command', 'natural app UI status phrase did not use the local app_ui_status fast path', naturalAppUiStatus.data),
    );

    const naturalAppWorkflow = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '打开 Calculator 然后关闭窗口',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_app_workflow',
      },
      timeoutMs: 30000,
    });
    const naturalAppWorkflowData = naturalAppWorkflow.data || {};
    const naturalAppWorkflowResult = naturalAppWorkflowData.route?.data?.result || {};
    const naturalAppWorkflowSteps = naturalAppWorkflowResult.plan?.steps || [];
    out.push(
      naturalAppWorkflow.ok &&
        naturalAppWorkflowData.ok === true &&
        naturalAppWorkflowData.executed === false &&
        naturalAppWorkflowData.route?.decision?.localCommand === 'app_workflow' &&
        naturalAppWorkflowData.route?.localCommand?.intent === 'app_workflow' &&
        naturalAppWorkflowResult.reusedLocalPlan === true &&
        naturalAppWorkflowResult.executed === false &&
        naturalAppWorkflowResult.plan?.source === 'deterministic' &&
        naturalAppWorkflowSteps.some((step) => step.type === 'open_app' && step.app === 'Calculator') &&
        naturalAppWorkflowSteps.some((step) => step.type === 'wait') &&
        naturalAppWorkflowSteps.some((step) => step.type === 'hotkey' && step.keys === 'cmd+w') &&
        typeof naturalAppWorkflowData.route?.output === 'string' &&
        naturalAppWorkflowData.route.output.includes('open_app') &&
        naturalAppWorkflowData.route.output.includes('hotkey') &&
        naturalAppWorkflowData.safety?.startsMicrophone === false &&
        naturalAppWorkflowData.safety?.usesRealtime === false &&
        naturalAppWorkflowData.safety?.storesRawAudio === false &&
        naturalAppWorkflowData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_app_workflow_preview', 'Natural app workflow preview voice command', '打开 Calculator 然后关闭窗口 reuses deterministic local plan without cloud/realtime')
        : fail('voice_command.natural_app_workflow_preview', 'Natural app workflow preview voice command', 'natural app workflow phrase did not use the deterministic local app_workflow preview path', naturalAppWorkflow.data),
    );

    const naturalDelegate = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '交给 Codex 检查 docs/ROADMAP.md，先不要执行',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_natural_delegate',
      },
      timeoutMs: 30000,
    });
    const naturalDelegateData = naturalDelegate.data || {};
    const naturalDelegatePayload = naturalDelegateData.route?.data?.delegate || {};
    out.push(
      naturalDelegate.ok &&
        naturalDelegateData.ok === true &&
        naturalDelegateData.executed === false &&
        naturalDelegateData.route?.decision?.localCommand === 'delegate_task' &&
        naturalDelegateData.route?.localCommand?.intent === 'delegate_task' &&
        naturalDelegatePayload.status === 'preview' &&
        naturalDelegatePayload.mode === 'codex' &&
        naturalDelegatePayload.scope === 'docs/ROADMAP.md' &&
        naturalDelegatePayload.access === 'read' &&
        naturalDelegatePayload.previewOnly === true &&
        naturalDelegatePayload.queued === false &&
        naturalDelegateData.safety?.startsMicrophone === false &&
        naturalDelegateData.safety?.usesRealtime === false &&
        naturalDelegateData.safety?.storesRawAudio === false &&
        naturalDelegateData.safety?.callsOpenAIImmediately === false &&
        naturalDelegateData.speech?.dryRun === true
        ? ok('voice_command.natural_delegate', 'Natural delegate voice command', '交给 Codex ... routes to read-only delegate_task preview without cloud/realtime')
        : fail('voice_command.natural_delegate', 'Natural delegate voice command', 'natural delegate phrase did not use the local delegate_task preview path', naturalDelegate.data),
    );

    const naturalDelegateGate = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '交给 Codex 检查 docs/ROADMAP.md',
        execute: true,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_natural_delegate_gate',
      },
      timeoutMs: 30000,
    });
    const naturalDelegateGateData = naturalDelegateGate.data || {};
    const naturalDelegateGatePayload = naturalDelegateGateData.route?.data?.delegate || {};
    out.push(
      naturalDelegateGate.ok &&
        naturalDelegateGateData.ok === true &&
        naturalDelegateGateData.requestedExecute === true &&
        naturalDelegateGateData.executed === false &&
        naturalDelegateGateData.route?.decision?.localCommand === 'delegate_task' &&
        naturalDelegateGatePayload.status === 'confirmation_required' &&
        naturalDelegateGatePayload.requiresConfirmation === true &&
        naturalDelegateGatePayload.previewOnly === true &&
        naturalDelegateGatePayload.queued === false &&
        naturalDelegateGatePayload.safety?.startsWorkers === false &&
        naturalDelegateGateData.safety?.startsMicrophone === false &&
        naturalDelegateGateData.safety?.usesRealtime === false &&
        naturalDelegateGateData.safety?.storesRawAudio === false &&
        naturalDelegateGateData.safety?.callsOpenAIImmediately === false
        ? ok('voice_command.natural_delegate_gate', 'Natural delegate confirmation gate', 'natural delegate --run stops at confirmation_required without starting a worker')
        : fail('voice_command.natural_delegate_gate', 'Natural delegate confirmation gate', 'natural delegate execute request did not stop at confirmation gate', naturalDelegateGate.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, [
        'scripts/local-voice-command-dogfood.mjs',
        '--json',
        '--request-timeout-ms',
        '30000',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const dogfood = parseJson(stdout);
      out.push(
        dogfood.ok === true &&
          dogfood.cliMode === 'dogfood' &&
          dogfood.previewOnly === true &&
          dogfood.executed === false &&
          dogfood.speech?.dryRun === true &&
          dogfood.safety?.startsMicrophone === false &&
          dogfood.safety?.usesRealtime === false &&
          dogfood.safety?.storesRawAudio === false &&
          dogfood.safety?.usesMemory === false &&
          dogfood.safety?.usesContextMetadata === true &&
          dogfood.context?.metadataOnly === true &&
          dogfood.context?.includesScreenImage === false &&
          dogfood.context?.includesClipboardText === false &&
          dogfood.context?.includesAccessibilityNodes === false
          ? ok('voice_command.dogfood_preview', 'Local voice command dogfood', `${dogfood.route?.lane || '-'} preview with spoken ack dry-run`)
          : fail('voice_command.dogfood_preview', 'Local voice command dogfood', 'dogfood preview missing safety markers', dogfood),
      );
    } catch (error) {
      out.push(fail('voice_command.dogfood_preview', 'Local voice command dogfood', error instanceof Error ? error.message : String(error)));
    }

    const localCliTranscript = '看一下当前窗口，判断下一步应该交给哪个本地通道，先不要执行。';
    try {
      const { stdout } = await execFileAsync('npm', [
        'run',
        'voice',
        '--',
        '--json',
        '--request-timeout-ms',
        '30000',
        localCliTranscript,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const localCli = parseJson(stdout);
      out.push(
        localCli.ok === true &&
          localCli.cliMode === 'local' &&
          localCli.previewOnly === true &&
          localCli.payload?.includeScreen === true &&
          localCli.payload?.includeAccessibility === true &&
          localCli.executed === false &&
          localCli.safety?.startsMicrophone === false &&
          localCli.safety?.usesRealtime === false &&
          localCli.safety?.storesRawAudio === false &&
          localCli.context?.metadataOnly === true &&
          localCli.context?.includesScreenImage === false &&
          localCli.context?.includesClipboardText === false &&
          localCli.context?.includesAccessibilityNodes === false &&
          localCli.context?.includeScreenRequested === true &&
          localCli.context?.includeAccessibilityRequested === true
          ? ok('voice_command.local_cli', 'Local voice command CLI', `${localCli.route?.lane || '-'} preview with default screen/UI metadata and no mic/realtime`)
          : fail('voice_command.local_cli', 'Local voice command CLI', 'npm run voice did not produce the safe local intake envelope', localCli),
      );
    } catch (error) {
      out.push(fail('voice_command.local_cli', 'Local voice command CLI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync('/bin/sh', [
        '-lc',
        "printf '/try\\n/status\\n/latency\\n/spend\\n/app\\n/ui 打开 Calculator 然后关闭窗口\\n/file list .\\n/file organize .\\n/browser\\n/browse extract_actions 提取当前网页行动项，先预览。\\n/open https://example.com\\n/delegate codex scope docs/ROADMAP.md access read Read-only inspect docs/ROADMAP.md and return two bullets. Do not write files.\\n/jobs\\n/progress\\n/next\\n/learn\\n/history\\n/agent 检查 JAVIS 状态，先不要执行。\\n状态\\n继续刚才那个\\n/exit\\n' | JAVIS_LOCAL_VOICE_CLI=true node scripts/local-voice-command-dogfood.mjs --chat --json --no-speech --no-session --no-screen --no-ui --request-timeout-ms 20000",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 90000,
        maxBuffer: 1024 * 1024,
      });
      const loop = parseJson(stdout);
      const turns = Array.isArray(loop.turns) ? loop.turns : [];
      const commandTurns = turns.filter((turn) => turn.kind === 'loop_command');
      const voiceTurns = turns.filter((turn) => turn.kind !== 'loop_command');
      const tryTurn = commandTurns.find((turn) => turn.command === 'try') || {};
      const statusTurn = commandTurns.find((turn) => turn.command === 'status') || {};
      const latencyTurn = commandTurns.find((turn) => turn.command === 'latency') || {};
      const spendTurn = commandTurns.find((turn) => turn.command === 'spend') || {};
      const appTurn = commandTurns.find((turn) => turn.command === 'app') || {};
      const uiTurn = commandTurns.find((turn) => turn.command === 'ui') || {};
      const fileTurn = commandTurns.find((turn) => turn.command === 'file' && turn.fileAction === 'list_directory') || {};
      const fileWorkflowTurn = commandTurns.find((turn) => turn.command === 'file' && turn.workflowIntent === 'organize') || {};
      const browserTurn = commandTurns.find((turn) => turn.command === 'browser') || {};
      const browseTurn = commandTurns.find((turn) => turn.command === 'browse') || {};
      const openTurn = commandTurns.find((turn) => turn.command === 'open') || {};
      const delegateTurn = commandTurns.find((turn) => turn.command === 'delegate') || {};
      const jobsTurn = commandTurns.find((turn) => turn.command === 'jobs') || {};
      const progressTurn = commandTurns.find((turn) => turn.command === 'progress') || {};
      const nextTurn = commandTurns.find((turn) => turn.command === 'next') || {};
      const learnTurn = commandTurns.find((turn) => turn.command === 'learn') || {};
      const agentTurn = commandTurns.find((turn) => turn.command === 'agent') || {};
      const sessionId = turns.find((turn) => turn.session?.sessionId)?.session?.sessionId || '';
      if (sessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(sessionId)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_voice_command_loop_cleanup',
            note: 'Cleaning up eval-created local voice loop session.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
      out.push(
          loop.ok === true &&
          loop.cliMode === 'local' &&
          loop.loop === true &&
          loop.turnCount === 20 &&
          loop.previewOnly === true &&
          loop.safety?.startsMicrophone === false &&
          loop.safety?.usesRealtime === false &&
          loop.safety?.storesRawAudio === false &&
          commandTurns.length === 18 &&
          ['try', 'status', 'latency', 'spend', 'app', 'ui', 'file', 'browser', 'browse', 'open', 'delegate', 'jobs', 'progress', 'next', 'learn', 'history', 'agent'].every((command) => commandTurns.some((turn) => turn.command === command)) &&
          tryTurn.detailLevel === 'fast' &&
          tryTurn.endpoint === '/api/voice/standby' &&
          tryTurn.output.includes('Try:') &&
          tryTurn.output.includes('Examples:') &&
          tryTurn.output.includes('Safety: read-only') &&
          statusTurn.detailLevel === 'fast' &&
          statusTurn.endpoint === '/api/pet/status' &&
          statusTurn.output.includes('Pet:') &&
          latencyTurn.detailLevel === 'fast' &&
          latencyTurn.endpoint === '/api/voice/latency?limit=20&auditLimit=500' &&
          latencyTurn.output.includes('Latency:') &&
          latencyTurn.output.includes('Safety: read-only') &&
          spendTurn.detailLevel === 'fast' &&
          spendTurn.endpoint === '/api/openai/spend-guard' &&
          spendTurn.output.includes('OpenAI spend:') &&
          spendTurn.output.includes('Blocked locally:') &&
          spendTurn.output.includes('Safety: read-only') &&
          appTurn.detailLevel === 'fast' &&
          appTurn.endpoint === '/api/ambient?limit=1' &&
          appTurn.output.includes('App:') &&
          appTurn.output.includes('UI: skipped in fast mode') &&
          uiTurn.detailLevel === 'preview' &&
          uiTurn.endpoint === '/api/app/plan' &&
          uiTurn.previewOnly === true &&
          uiTurn.task === '打开 Calculator 然后关闭窗口' &&
          uiTurn.output.includes('UI: preview only') &&
          uiTurn.output.includes('open_app') &&
          fileTurn.detailLevel === 'fast' &&
          fileTurn.endpoint === '/api/files/execute' &&
          fileTurn.previewOnly === true &&
          fileTurn.fileAction === 'list_directory' &&
          fileTurn.filePath === '.' &&
          fileTurn.output.includes('File: list_directory') &&
          fileTurn.output.includes('Result:') &&
          fileWorkflowTurn.detailLevel === 'preview' &&
          fileWorkflowTurn.endpoint === '/api/files/workflow' &&
          fileWorkflowTurn.previewOnly === true &&
          fileWorkflowTurn.workflowIntent === 'organize' &&
          fileWorkflowTurn.filePath === '.' &&
          fileWorkflowTurn.output.includes('File workflow: preview only') &&
          fileWorkflowTurn.output.includes('Plan:') &&
          browserTurn.detailLevel === 'fast' &&
          browserTurn.endpoint === '/api/browser/activity?limit=4' &&
          browserTurn.output.includes('Browser:') &&
          browserTurn.output.includes('metadata-only') &&
          browseTurn.detailLevel === 'preview' &&
          browseTurn.endpoint === '/api/browser/workflow' &&
          browseTurn.previewOnly === true &&
          browseTurn.intent === 'extract_actions' &&
          browseTurn.mode === 'quick' &&
          browseTurn.output.includes('Browse: preview only') &&
          openTurn.detailLevel === 'preview' &&
          openTurn.endpoint === '/api/voice/command' &&
          openTurn.previewOnly === true &&
          openTurn.targetKind === 'url' &&
          openTurn.target === 'https://example.com' &&
          openTurn.output.includes('Open: preview only') &&
          delegateTurn.detailLevel === 'preview' &&
          delegateTurn.endpoint === '/api/tools/execute' &&
          delegateTurn.previewOnly === true &&
          delegateTurn.delegateMode === 'codex' &&
          delegateTurn.delegateScope === 'docs/ROADMAP.md' &&
          delegateTurn.delegateStatus === 'preview' &&
          delegateTurn.output.includes('Delegate: preview only') &&
          delegateTurn.output.includes('Status: preview') &&
          jobsTurn.detailLevel === 'fast' &&
          jobsTurn.endpoint === '/api/work/progress?jobLimit=5&workflowLimit=5' &&
          jobsTurn.output.includes('Jobs:') &&
          jobsTurn.output.includes('Workers:') &&
          progressTurn.detailLevel === 'fast' &&
          progressTurn.endpoint === '/api/work/progress?jobLimit=5&workflowLimit=5' &&
          progressTurn.output.includes('Workflows:') &&
          progressTurn.output.includes('Next:') &&
          nextTurn.detailLevel === 'fast' &&
          nextTurn.endpoint?.includes('compact=true') &&
          learnTurn.detailLevel === 'fast' &&
          learnTurn.endpoint === '/api/tools/execute' &&
          learnTurn.output.includes('Learning:') &&
          learnTurn.output.includes('Habit candidates:') &&
          learnTurn.output.includes('Safety: read-only') &&
          agentTurn.detailLevel === 'fast' &&
          agentTurn.agentSteps === 4 &&
          commandTurns.every((turn) => (
            turn.ok === true &&
            turn.previewOnly === true &&
            typeof turn.elapsedMs === 'number' &&
            turn.elapsedMs >= 0 &&
            (turn.apiElapsedMs === undefined || turn.apiElapsedMs >= 0) &&
            typeof turn.output === 'string' &&
            turn.output.length > 0 &&
            turn.safety?.readOnly === true &&
            turn.safety?.startsMicrophone === false &&
            turn.safety?.usesRealtime === false &&
            turn.safety?.storesRawAudio === false
          )) &&
          voiceTurns.length === 2 &&
          voiceTurns.every((turn) => (
            turn.ok === true &&
            turn.previewOnly === true &&
            turn.safety?.startsMicrophone === false &&
            turn.safety?.usesRealtime === false &&
            turn.safety?.storesRawAudio === false &&
            turn.context?.metadataOnly === true &&
            turn.context?.includesScreenImage === false &&
            turn.context?.includesClipboardText === false &&
            turn.context?.includesAccessibilityNodes === false &&
            typeof turn.elapsedMs === 'number' &&
            turn.elapsedMs >= 0 &&
            typeof turn.apiElapsedMs === 'number' &&
            turn.apiElapsedMs >= 0 &&
            turn.session?.recorded === false &&
            turn.session?.reason === 'disabled' &&
            turn.session?.privacy?.transcriptPreviewOnly === true &&
            turn.session?.privacy?.noRawAudio === true
          ))
          ? ok('voice_command.local_cli_loop', 'Local voice command loop CLI', `${loop.turnCount} safe no-mic turns with read-only slash commands and disabled session writes`)
          : fail('voice_command.local_cli_loop', 'Local voice command loop CLI', 'npm run voice:chat did not keep the safe local loop envelope', loop),
      );
    } catch (error) {
      out.push(fail('voice_command.local_cli_loop', 'Local voice command loop CLI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync('/bin/sh', [
        '-lc',
        "printf '/delegate codex scope docs/ROADMAP.md access read Read-only inspect docs/ROADMAP.md and return two bullets. Do not write files.\\n/exit\\n' | JAVIS_LOCAL_VOICE_CLI=true node scripts/local-voice-command-dogfood.mjs --chat --json --run --no-speech --no-session --no-screen --no-ui --request-timeout-ms 20000",
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const delegateLoop = parseJson(stdout);
      const delegateTurn = Array.isArray(delegateLoop.turns) ? delegateLoop.turns.find((turn) => turn.command === 'delegate') || {} : {};
      out.push(
        delegateLoop.ok === true &&
          delegateLoop.loop === true &&
          delegateLoop.turnCount === 1 &&
          delegateTurn.ok === true &&
          delegateTurn.endpoint === '/api/tools/execute' &&
          delegateTurn.detailLevel === 'execute_gate' &&
          delegateTurn.previewOnly === true &&
          delegateTurn.delegateMode === 'codex' &&
          delegateTurn.delegateStatus === 'confirmation_required' &&
          delegateTurn.safety?.readOnly === true &&
          delegateTurn.output.includes('Status: confirmation_required') &&
          delegateTurn.output.includes('queued=no') &&
          delegateTurn.output.includes('executed=no')
          ? ok('voice_command.delegate_gate', 'Local voice delegate confirmation gate', 'delegate --run reaches confirmation_required without starting a worker')
          : fail('voice_command.delegate_gate', 'Local voice delegate confirmation gate', 'delegate --run did not stop at the confirmation gate', delegateLoop),
      );
    } catch (error) {
      out.push(fail('voice_command.delegate_gate', 'Local voice delegate confirmation gate', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-local-voice-loop'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      out.push(
        stdout.includes('JAVIS Local Voice Command Loop') &&
          stdout.includes('npm run voice:chat') &&
          stdout.includes('Input mode: Push-to-talk') &&
          stdout.includes('/jobs or /progress') &&
          stdout.includes('starts microphone=no') &&
          stdout.includes('uses Realtime=no') &&
          stdout.includes('screen/UI context is metadata-only')
          ? ok('voice_command.cui_loop_quickstart', 'Local voice loop CUI quickstart', 'config CUI exposes the no-mic continuous local intake quickstart')
          : fail('voice_command.cui_loop_quickstart', 'Local voice loop CUI quickstart', 'config CUI did not expose the expected local loop quickstart', { output: stdout.slice(0, 1200) }),
      );
    } catch (error) {
      out.push(fail('voice_command.cui_loop_quickstart', 'Local voice loop CUI quickstart', error instanceof Error ? error.message : String(error)));
    }

    const wakeCommand = await ctx.api('/api/wake/command', {
      method: 'POST',
      body: {
        transcript: '贾维斯，唤起后走本地语音指挥，先不要执行。',
        phrase: '贾维斯',
        execute: false,
        includeScreen: true,
        includeAccessibility: true,
        speak: false,
        useMemory: false,
        source: 'eval_wake_voice_command',
      },
      timeoutMs: 45000,
    });
    const wakeCommandData = wakeCommand.data || {};
    out.push(
      wakeCommand.ok &&
        wakeCommandData.ok === true &&
        wakeCommandData.channel === 'wake_voice_command' &&
        wakeCommandData.wake?.pending === true &&
        ['local_voice_fallback', 'realtime_or_local'].includes(wakeCommandData.handoff?.mode) &&
        wakeCommandData.handoff?.input?.endpoint === '/api/voice/command' &&
        wakeCommandData.requestedExecute === false &&
        wakeCommandData.executed === false &&
        wakeCommandData.safety?.startsMicrophone === false &&
        wakeCommandData.safety?.usesRealtime === false &&
        wakeCommandData.safety?.storesRawAudio === false &&
        wakeCommandData.safety?.usesWakeTrigger === true &&
        wakeCommandData.context?.metadataOnly === true &&
        wakeCommandData.context?.includesScreenImage === false &&
        wakeCommandData.context?.includesClipboardText === false &&
        wakeCommandData.context?.includesAccessibilityNodes === false
        ? ok('voice_command.wake_command_api', 'Wake + local voice command API', `${wakeCommandData.handoff?.mode || '-'} · ${wakeCommandData.route?.decision?.lane || '-'} · no mic/realtime/raw audio`)
        : fail('voice_command.wake_command_api', 'Wake + local voice command API', `expected safe wake command envelope, got ${wakeCommand.status}`, wakeCommand.data),
    );

    const routeContinuationPreview = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '请后台整理这个本地语音预览任务，生成一个三步执行计划，先不要执行。',
        mode: 'background',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_route_preview_continue',
      },
      timeoutMs: 30000,
    });
    const routeContinuationData = routeContinuationPreview.data || {};
    const previewRouteId = routeContinuationData.route?.routing?.id || '';
    const workNextRoute = previewRouteId
      ? await ctx.api(`/api/work/next?actionId=route:${encodeURIComponent(previewRouteId)}`, { timeoutMs: 30000 })
      : { ok: false, status: 0, data: { error: 'missing preview route id' } };
    const workNextData = workNextRoute.data?.next || {};
    const recommended = workNextData.result?.routeRecovery?.recommended || workNextData.action?.routeRecovery?.recommended || {};
    const continuationLane = routeContinuationData.route?.decision?.lane || '';
    out.push(
      routeContinuationPreview.ok &&
        routeContinuationData.ok === true &&
        routeContinuationData.executed === false &&
        ['background', 'quick', 'local'].includes(continuationLane) &&
        previewRouteId &&
        workNextRoute.ok &&
        workNextData.ok === true &&
        workNextData.executed === false &&
        workNextData.action?.id === `route:${previewRouteId}` &&
        workNextData.action?.source === 'routing' &&
        workNextData.action?.executable === true &&
        recommended.type === 'route_preview_execute' &&
        recommended.executable === true &&
        recommended.routeId === previewRouteId &&
        workNextData.output?.includes('预览模式')
        ? ok('voice_command.route_preview_continue', 'Voice route preview continuation', `${previewRouteId} exposes executable ${continuationLane} route_preview_execute without running it`)
        : fail('voice_command.route_preview_continue', 'Voice route preview continuation', `expected route preview continuation candidate, got ${workNextRoute.status}`, {
            route: routeContinuationData.route,
            previewRouteId,
            workNext: workNextRoute.data,
        }),
    );

    const localContinueSeed = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '状态',
        execute: false,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_continue_last_seed',
      },
      timeoutMs: 30000,
    });
    const localContinueRouteId = localContinueSeed.data?.route?.routing?.id || '';
    const localContinue = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '执行刚才的预览',
        execute: true,
        includeScreen: false,
        useMemory: false,
        speak: false,
        source: 'eval_voice_continue_last_route',
      },
      timeoutMs: 30000,
    });
    const localContinueData = localContinue.data || {};
    const continued = localContinueData.route?.data?.lastVoiceRoute || {};
    const continuedResult = localContinueData.route?.data?.result || {};
    out.push(
      localContinueSeed.ok &&
        localContinueRouteId &&
        localContinue.ok &&
        localContinueData.ok === true &&
        localContinueData.requestedExecute === true &&
        localContinueData.executed === true &&
        localContinueData.heldReason === '' &&
        localContinueData.route?.localCommand?.intent === 'continue_last_voice_route' &&
        continued.routeId === localContinueRouteId &&
        continuedResult.executed === true &&
        localContinueData.safety?.executesLocalCommand === true &&
        localContinueData.safety?.callsOpenAIImmediately === false &&
        String(localContinueData.route?.output || '').includes(localContinueRouteId)
        ? ok('voice_command.continue_last_route', 'Voice continue last route', `${localContinueRouteId} continued from natural preview-execute wording without quick cloud call`)
        : fail('voice_command.continue_last_route', 'Voice continue last route', `expected voice command to continue latest route, got ${localContinue.status}`, {
            seed: localContinueSeed.data,
            localContinue: localContinue.data,
            localContinueRouteId,
          }),
    );

    try {
      const { stdout } = await execFileAsync('npm', [
        'run',
        'wake',
        '--',
        '--json',
        '--request-timeout-ms',
        '30000',
        '贾维斯，命令行唤起后看当前窗口，先不要执行。',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 45000,
        maxBuffer: 1024 * 1024,
      });
      const wakeCli = parseJson(stdout);
      out.push(
        wakeCli.ok === true &&
          wakeCli.cliMode === 'local' &&
          wakeCli.payload?.wake === true &&
          wakeCli.previewOnly === true &&
          wakeCli.wake?.pending === true &&
          ['local_voice_fallback', 'realtime_or_local'].includes(wakeCli.wake?.handoffMode) &&
          wakeCli.safety?.startsMicrophone === false &&
          wakeCli.safety?.usesRealtime === false &&
          wakeCli.safety?.storesRawAudio === false &&
          wakeCli.context?.metadataOnly === true &&
          wakeCli.context?.includesScreenImage === false &&
          wakeCli.context?.includesClipboardText === false &&
          wakeCli.context?.includesAccessibilityNodes === false
          ? ok('voice_command.wake_command_cli', 'Wake + local voice command CLI', `${wakeCli.wake?.handoffMode || '-'} preview through npm run wake`)
          : fail('voice_command.wake_command_cli', 'Wake + local voice command CLI', 'npm run wake did not produce the safe wake intake envelope', wakeCli),
      );
    } catch (error) {
      out.push(fail('voice_command.wake_command_cli', 'Wake + local voice command CLI', error instanceof Error ? error.message : String(error)));
    }

    const sessionTranscript = '状态';
    let cleanupSessionId = '';
    try {
      const sessionsBefore = await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 });
      let targetSession = sessionsBefore.data?.sessions?.active || null;
      const activeLooksLikeEval = targetSession && (
        targetSession.source === 'eval_voice_command_session_ledger' ||
        String(targetSession.goal || '').startsWith('eval local voice session ledger')
      );
      if (activeLooksLikeEval) {
        await ctx.api(`/api/sessions/${encodeURIComponent(targetSession.id)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_voice_command_session_cleanup',
            note: 'Cleaning up stale eval-created local voice session.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(targetSession.id)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
        targetSession = null;
      }
      if (!targetSession?.id) {
        const startSession = await ctx.api('/api/sessions/start', {
          method: 'POST',
          body: {
            goal: `eval local voice session ledger ${Date.now()}`,
            source: 'eval_voice_command_session_ledger',
          },
          timeoutMs: 10000,
        });
        targetSession = startSession.data?.session || null;
        cleanupSessionId = targetSession?.id || '';
      }

      const sessionVoice = targetSession?.id
        ? await ctx.api('/api/voice/command', {
          method: 'POST',
          body: {
            transcript: sessionTranscript,
            execute: false,
            includeScreen: false,
            useMemory: false,
            speak: false,
            session: true,
            sessionId: targetSession.id,
            source: 'eval_voice_command_session_ledger',
          },
          timeoutMs: 30000,
        })
        : { ok: false, status: 0, data: { error: 'missing target session' } };
      const sessionData = sessionVoice.data?.session || {};
      const sessionAfterVoice = targetSession?.id
        ? await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 })
        : { ok: false, data: null };
      const activeAfterVoice = sessionAfterVoice.data?.sessions?.active || null;
      const recordedEvent = activeAfterVoice?.id === targetSession?.id
        ? (activeAfterVoice.events || []).find((event) => event.type === 'voice_command' && event.source === 'eval_voice_command_session_ledger') || null
        : null;

      out.push(
        targetSession?.id &&
          sessionVoice.ok &&
          sessionVoice.data?.ok === true &&
          (sessionData.recorded === true || Boolean(recordedEvent)) &&
          (sessionData.sessionId === targetSession.id || recordedEvent?.id) &&
          (sessionData.eventId || recordedEvent?.id) &&
          (sessionData.eventType === 'voice_command' || recordedEvent?.type === 'voice_command') &&
          (sessionData.privacy?.transcriptPreviewOnly === true || recordedEvent?.text?.includes('Voice intake:')) &&
          (sessionData.privacy?.noRawAudio === true || !String(recordedEvent?.text || '').toLowerCase().includes('raw audio')) &&
          (sessionData.privacy?.noScreenImages === true || !String(recordedEvent?.text || '').includes('screenImage')) &&
          (sessionData.privacy?.noClipboardText === true || !String(recordedEvent?.text || '').includes('clipboardText')) &&
          (sessionData.privacy?.noAccessibilityNodes === true || !String(recordedEvent?.text || '').includes('accessibilityNodes')) &&
          !hasForbiddenHistoryPayload(sessionData) &&
          !hasForbiddenHistoryPayload(recordedEvent || {})
          ? ok('voice_command.session_ledger', 'Voice command session ledger', `${sessionData.title || targetSession.title} recorded event ${sessionData.eventId || recordedEvent?.id}`)
          : fail('voice_command.session_ledger', 'Voice command session ledger', 'voice command did not append a sanitized work-session event', {
              targetSession,
              sessionVoice: sessionVoice.data,
              activeAfterVoice,
            }),
      );
    } catch (error) {
      out.push(fail('voice_command.session_ledger', 'Voice command session ledger', error instanceof Error ? error.message : String(error)));
    } finally {
      if (cleanupSessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionId)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_voice_command_session_cleanup',
            note: 'Cleaning up eval-created local voice session.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
    }

    const sessionNoteText = `eval natural session note ${Date.now()}`;
    let cleanupNaturalSessionId = '';
    try {
      const sessionsBefore = await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 });
      let targetSession = sessionsBefore.data?.sessions?.active || null;
      if (!targetSession?.id) {
        const startSession = await ctx.api('/api/sessions/start', {
          method: 'POST',
          body: {
            goal: `eval natural session note ${Date.now()}`,
            source: 'eval_voice_command_session_note_setup',
          },
          timeoutMs: 10000,
        });
        targetSession = startSession.data?.session || null;
        cleanupNaturalSessionId = targetSession?.id || '';
      }

      const noteCommand = targetSession?.id
        ? await ctx.api('/api/voice/command', {
          method: 'POST',
          body: {
            transcript: `记到当前会话：${sessionNoteText}`,
            execute: true,
            includeScreen: false,
            includeAccessibility: false,
            useMemory: false,
            speak: false,
            source: 'eval_voice_command_session_note_natural',
          },
          timeoutMs: 20000,
        })
        : { ok: false, status: 0, data: { error: 'missing target session' } };
      const noteRoute = noteCommand.data?.route || {};
      const noteData = noteRoute.data || {};
      const noteEvent = noteData.event || null;
      const noteSafety = noteData.safety || {};
      const sessionsAfter = targetSession?.id
        ? await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 })
        : { ok: false, data: null };
      const activeAfter = sessionsAfter.data?.sessions?.active || null;
      const persistedNote = activeAfter?.id === targetSession?.id
        ? (activeAfter.events || []).find((event) => event.type === 'note' && event.text === sessionNoteText) || null
        : null;

      out.push(
        targetSession?.id &&
          noteCommand.ok &&
          noteCommand.data?.ok === true &&
          noteCommand.data?.executed === true &&
          noteRoute.localCommand?.intent === 'session_note' &&
          noteRoute.decision?.localCommand === 'session_note' &&
          String(noteRoute.output || '').includes('已记录到会话') &&
          noteEvent?.text === sessionNoteText &&
          persistedNote?.text === sessionNoteText &&
          noteSafety.readOnly === false &&
          noteSafety.mutatesLocalSession === true &&
          noteSafety.mutatesUserFiles === false &&
          noteSafety.startsMicrophone === false &&
          noteSafety.usesRealtime === false &&
          noteSafety.opensTerminal === false &&
          noteSafety.capturesScreen === false &&
          noteRoute.contextPlan?.needs?.screen === false &&
          noteRoute.contextPlan?.needs?.accessibility === false
          ? ok('voice_command.natural_session_note', 'Natural session note voice command', `${targetSession.title} recorded ${noteEvent.id}`)
          : fail('voice_command.natural_session_note', 'Natural session note voice command', 'expected natural session note to write one local session event without mic, Realtime, Terminal, screen, or file mutation', {
              targetSession,
              noteCommand: noteCommand.data,
              activeAfter,
            }),
      );
    } catch (error) {
      out.push(fail('voice_command.natural_session_note', 'Natural session note voice command', error instanceof Error ? error.message : String(error)));
    } finally {
      if (cleanupNaturalSessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupNaturalSessionId)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_voice_command_session_note_cleanup',
            note: 'Cleaning up eval-created natural session note.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupNaturalSessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
    }

    const loopSessionGoal = `eval loop session ${Date.now()}`;
    const loopSessionNote = `eval loop note ${Date.now()}`;
    let loopCleanupSessionId = '';
    try {
      const sessionsBeforeLoop = await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 });
      const activeBeforeLoop = sessionsBeforeLoop.data?.sessions?.active || null;
      if (activeBeforeLoop?.source === 'local_voice_loop_session_start' && String(activeBeforeLoop.goal || '').startsWith('eval loop session')) {
        await ctx.api(`/api/sessions/${encodeURIComponent(activeBeforeLoop.id)}/end`, {
          method: 'POST',
          body: {
            source: 'eval_voice_command_loop_session_cleanup',
            note: 'Cleaning up stale eval loop session.',
          },
          timeoutMs: 10000,
        });
        await ctx.api(`/api/sessions/${encodeURIComponent(activeBeforeLoop.id)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }

      const { stdout } = await spawnWithInput('npm', ['run', 'voice:chat', '--', '--json'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_LOCAL_VOICE_CLI: 'true',
        },
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      }, `/session start ${loopSessionGoal}\n/note ${loopSessionNote}\n/session end eval loop cleanup\n/exit\n`);
      const loopSession = parseJson(stdout);
      const turns = Array.isArray(loopSession.turns) ? loopSession.turns : [];
      const startTurn = turns.find((turn) => turn.command === 'session' && String(turn.output || '').includes(loopSessionGoal));
      const noteTurn = turns.find((turn) => turn.command === 'note' && String(turn.output || '').includes(loopSessionNote));
      const endTurn = turns.find((turn) => turn.command === 'session' && String(turn.output || '').includes('Summary:'));
      const sessionsAfterLoop = await ctx.api('/api/sessions?limit=5', { timeoutMs: 10000 });
      const endedLoopSession = (sessionsAfterLoop.data?.sessions?.items || []).find((session) =>
        session.goal === loopSessionGoal || session.title === loopSessionGoal);
      loopCleanupSessionId = endedLoopSession?.id || '';

      out.push(
        loopSession.ok === true &&
          loopSession.turnCount === 3 &&
          startTurn?.ok === true &&
          noteTurn?.ok === true &&
          endTurn?.ok === true &&
          startTurn.previewOnly === false &&
          noteTurn.previewOnly === false &&
          endTurn.previewOnly === false &&
          startTurn.safety?.mutatesLocalSession === true &&
          noteTurn.safety?.mutatesLocalSession === true &&
          endTurn.safety?.mutatesLocalSession === true &&
          startTurn.safety?.startsMicrophone === false &&
          noteTurn.safety?.usesRealtime === false &&
          endTurn.safety?.storesRawAudio === false &&
          String(noteTurn.output || '').includes(loopSessionNote) &&
          endedLoopSession?.status === 'done' &&
          (endedLoopSession.events || []).some((event) => event.type === 'note' && event.text === loopSessionNote)
          ? ok('voice_command.local_loop_session_commands', 'Local voice loop session commands', `${endedLoopSession?.id || 'session'} start/note/end without mic or Realtime`)
          : fail('voice_command.local_loop_session_commands', 'Local voice loop session commands', 'expected /session start, /note, and /session end to mutate only local session state', {
              loopSession,
              endedLoopSession,
            }),
      );
    } catch (error) {
      out.push(fail('voice_command.local_loop_session_commands', 'Local voice loop session commands', error instanceof Error ? error.message : String(error)));
    } finally {
      if (loopCleanupSessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(loopCleanupSessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
    }

    const history = await ctx.api('/api/voice/history?limit=50&auditLimit=500', { timeoutMs: 30000 });
    const historyData = history.data?.history || {};
    const historyItems = Array.isArray(historyData.items) ? historyData.items : [];
    const cliHistory = historyItems.find((item) => (
      String(item.source || '').includes('local_voice_command_cli') &&
      String(item.transcriptPreview || '').includes(localCliTranscript.slice(0, 8))
    ));
    const privacy = historyData.privacy || {};
    const latency = historyData.latency || {};
    const safety = cliHistory?.safety || {};
    out.push(
      history.ok &&
        historyData.ok === true &&
        privacy.localOnly === true &&
        privacy.transcriptPreviewOnly === true &&
        privacy.noRawAudio === true &&
        privacy.noScreenImages === true &&
        privacy.noClipboardText === true &&
        privacy.noAccessibilityNodes === true &&
        latency.count > 0 &&
        latency.latestMs >= 0 &&
        latency.avgMs >= 0 &&
        cliHistory &&
        cliHistory.elapsedMs > 0 &&
        cliHistory.timing?.totalMs > 0 &&
        cliHistory.timing?.previewRouteMs >= 0 &&
        cliHistory.includeScreen === true &&
        cliHistory.includeAccessibility === true &&
        cliHistory.transcriptPreview.includes(localCliTranscript.slice(0, 8)) &&
        cliHistory.contextSummary &&
        safety.startsMicrophone === false &&
        safety.usesRealtime === false &&
        safety.storesRawAudio === false &&
        safety.storesScreenImage === false &&
        safety.storesClipboardText === false &&
        safety.storesAccessibilityNodes === false &&
        !hasForbiddenHistoryPayload(cliHistory)
        ? ok('voice_command.history', 'Local voice command history', `${historyItems.length} item(s) · latency avg ${latency.avgMs}ms · preview-only transcript · no audio/screenshot/clipboard/AX payload`)
        : fail('voice_command.history', 'Local voice command history', `expected sanitized local voice history, got ${history.status}`, {
            privacy,
            found: Boolean(cliHistory),
            item: cliHistory || historyItems[0] || null,
          }),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-voice-history', '--limit', '20'], {
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
        stdout.includes('Local Voice Command History') &&
          stdout.includes('transcript-preview-only') &&
          stdout.includes('Latency: latest') &&
          stdout.includes('route:') &&
          stdout.includes('Continue: npm run work:run -- --action-id route:')
          ? ok('voice_command.history_cui', 'Local voice history CUI', 'CUI prints recent sanitized voice-command history with route continuation command')
          : fail('voice_command.history_cui', 'Local voice history CUI', 'CUI did not print the expected local voice history summary', { stdout }),
      );
    } catch (error) {
      out.push(fail('voice_command.history_cui', 'Local voice history CUI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-voice-latency', '--limit', '20'], {
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
        stdout.includes('Local Voice Latency') &&
          stdout.includes('Metrics: latest') &&
          stdout.includes('Safety: read-only local audit metadata') &&
          (stdout.includes('Likely bottleneck:') || stdout.includes('samples 0/'))
          ? ok('voice_command.latency_cui', 'Local voice latency CUI', 'CUI prints read-only local latency metrics and safety boundary')
          : fail('voice_command.latency_cui', 'Local voice latency CUI', 'CUI did not print the expected local voice latency report', { stdout }),
      );
    } catch (error) {
      out.push(fail('voice_command.latency_cui', 'Local voice latency CUI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-wake-handoff'], {
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
        stdout.includes('JAVIS Wake Handoff') &&
          stdout.includes('Command: npm run voice') &&
          stdout.includes('mic=no') &&
          stdout.includes('realtime=no')
          ? ok('voice_command.wake_handoff_cui', 'Wake handoff CUI', 'CUI prints read-only wake handoff and local intake command')
          : fail('voice_command.wake_handoff_cui', 'Wake handoff CUI', 'CUI did not print the expected wake handoff summary', { stdout }),
      );
    } catch (error) {
      out.push(fail('voice_command.wake_handoff_cui', 'Wake handoff CUI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const rendererSource = fs.readFileSync('src/App.tsx', 'utf8');
      const fallbackIndex = rendererSource.indexOf('const runLocalVoiceFallback = useCallback');
      const fallbackEndIndex = rendererSource.indexOf('  }, [addMessage, fallbackIncludesScreen', fallbackIndex);
      const fallbackSource = fallbackIndex >= 0 && fallbackEndIndex >= 0
        ? rendererSource.slice(fallbackIndex, fallbackEndIndex)
        : '';
      out.push(
        fallbackSource.includes("'/api/voice/command'") &&
          fallbackSource.includes('transcript: prompt') &&
          fallbackSource.includes('includeAccessibility: fallbackIncludesScreen') &&
          fallbackSource.includes('execute: true') &&
          fallbackSource.includes('confirmSpeak: true') &&
          fallbackSource.includes('useMemory: false') &&
          fallbackSource.includes('allowCloudQuick: false') &&
          !fallbackSource.includes("'/api/chat/quick'") &&
          !fallbackSource.includes("'/api/tasks/route'")
          ? ok('voice_command.renderer_fallback', 'Renderer fallback wiring', 'blocked Realtime pet prompts use /api/voice/command without quick-lane cloud fallback')
          : fail('voice_command.renderer_fallback', 'Renderer fallback wiring', 'renderer fallback is not wired to voice-command safely', {
              hasFallback: Boolean(fallbackSource),
              hasVoiceCommand: fallbackSource.includes("'/api/voice/command'"),
              hasChatQuick: fallbackSource.includes("'/api/chat/quick'"),
              hasTasksRoute: fallbackSource.includes("'/api/tasks/route'"),
              holdsCloudQuick: fallbackSource.includes('allowCloudQuick: false'),
              includesAccessibility: fallbackSource.includes('includeAccessibility: fallbackIncludesScreen'),
            }),
      );

      const openLoopIndex = rendererSource.indexOf('const openLocalVoiceEntry = useCallback');
      const openLoopEndIndex = rendererSource.indexOf('  }, [focusLocalInputPanel]', openLoopIndex);
      const openLoopSource = openLoopIndex >= 0 && openLoopEndIndex >= 0
        ? rendererSource.slice(openLoopIndex, openLoopEndIndex)
        : '';
      out.push(
        openLoopSource.includes("'/api/voice/standby'") &&
          openLoopSource.includes('execute: false') &&
          openLoopSource.includes("source: 'pet_voice_entry_preview'") &&
          openLoopSource.includes('focusLocalInputPanel') &&
          !openLoopSource.includes("'/api/voice/open-local-loop'")
          ? ok('voice_command.renderer_standby_primary', 'Renderer pet standby primary wiring', 'pet fallback click previews voice standby and opens local input without hardcoded terminal loop execution')
          : fail('voice_command.renderer_standby_primary', 'Renderer pet standby primary wiring', 'expected pet fallback click to preview voice standby and open local input without launching Terminal', {
              hasOpenLoop: Boolean(openLoopSource),
              hasVoiceStandby: openLoopSource.includes("'/api/voice/standby'"),
              hasExecuteFalse: openLoopSource.includes('execute: false'),
              hasLocalInput: openLoopSource.includes('focusLocalInputPanel'),
              hardcodedOpenLoop: openLoopSource.includes("'/api/voice/open-local-loop'"),
            }),
      );
      const localInputIndex = rendererSource.indexOf('const focusLocalInputPanel = useCallback');
      const localInputEndIndex = rendererSource.indexOf('  }, [addMessage, setWindowMode]', localInputIndex);
      const localInputSource = localInputIndex >= 0 && localInputEndIndex >= 0
        ? rendererSource.slice(localInputIndex, localInputEndIndex)
        : '';
      out.push(
        localInputSource.includes("setWindowMode('compose'") &&
          localInputSource.includes('quickInputRef.current?.focus()') &&
          !localInputSource.includes("setWindowMode('panel'")
          ? ok('voice_command.renderer_compose_input', 'Renderer quiet local input', 'local fallback opens the compact compose input instead of the full panel')
          : fail('voice_command.renderer_compose_input', 'Renderer quiet local input', 'expected local fallback to open compose mode and focus the input', {
              hasLocalInput: Boolean(localInputSource),
              opensCompose: localInputSource.includes("setWindowMode('compose'"),
              opensPanel: localInputSource.includes("setWindowMode('panel'"),
              focusesInput: localInputSource.includes('quickInputRef.current?.focus()'),
            }),
      );
      out.push(
        rendererSource.includes("wake.handoff?.mode === 'local_voice_fallback'") &&
          rendererSource.includes("status?.window?.mode === 'compose'") &&
          rendererSource.includes('beginAssistantSession()')
          ? ok('voice_command.renderer_wake_compose_guard', 'Renderer wake compose guard', 'summon-opened compose input is not re-opened through the fallback wake path')
          : fail('voice_command.renderer_wake_compose_guard', 'Renderer wake compose guard', 'expected renderer wake handler to skip duplicate fallback when compose is already open'),
      );
    } catch (error) {
      out.push(fail('voice_command.renderer_fallback', 'Renderer fallback wiring', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
