import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { ok, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

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
      timeoutMs: 15000,
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
        transcript: '看一下我当前窗口，告诉我应该走哪个工作通道，先不要执行。',
        execute: false,
        includeScreen: true,
        includeAccessibility: true,
        useMemory: false,
        speak: false,
        source: 'eval_voice_command_screen_context',
      },
      timeoutMs: 15000,
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

    const quickHeld = await ctx.api('/api/voice/command', {
      method: 'POST',
      body: {
        transcript: '你能用一句话回答我吗？',
        execute: true,
        useMemory: false,
        speak: true,
        source: 'eval_voice_command_quick_hold',
      },
      timeoutMs: 15000,
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
        heldData.speech?.dryRun === true
        ? ok('voice_command.quick_hold', 'Quick lane cloud hold', 'execute request is held locally instead of spending cloud quota')
        : fail('voice_command.quick_hold', 'Quick lane cloud hold', `expected held quick lane, got ${quickHeld.status}`, quickHeld.data),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/local-voice-command-dogfood.mjs', '--json'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 15000,
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
        localCliTranscript,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 20000,
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
      timeoutMs: 15000,
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
      timeoutMs: 15000,
    });
    const routeContinuationData = routeContinuationPreview.data || {};
    const previewRouteId = routeContinuationData.route?.routing?.id || '';
    const workNextRoute = previewRouteId
      ? await ctx.api(`/api/work/next?actionId=route:${encodeURIComponent(previewRouteId)}`, { timeoutMs: 15000 })
      : { ok: false, status: 0, data: { error: 'missing preview route id' } };
    const workNextData = workNextRoute.data?.next || {};
    const recommended = workNextData.result?.routeRecovery?.recommended || workNextData.action?.routeRecovery?.recommended || {};
    out.push(
      routeContinuationPreview.ok &&
        routeContinuationData.ok === true &&
        routeContinuationData.executed === false &&
        routeContinuationData.route?.decision?.lane === 'background' &&
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
        ? ok('voice_command.route_preview_continue', 'Voice route preview continuation', `${previewRouteId} exposes executable route_preview_execute without running it`)
        : fail('voice_command.route_preview_continue', 'Voice route preview continuation', `expected route preview continuation candidate, got ${workNextRoute.status}`, {
            route: routeContinuationData.route,
            previewRouteId,
            workNext: workNextRoute.data,
          }),
    );

    try {
      const { stdout } = await execFileAsync('npm', [
        'run',
        'wake',
        '--',
        '--json',
        '贾维斯，命令行唤起后看当前窗口，先不要执行。',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 20000,
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

    const history = await ctx.api('/api/voice/history?limit=12', { timeoutMs: 10000 });
    const historyData = history.data?.history || {};
    const historyItems = Array.isArray(historyData.items) ? historyData.items : [];
    const cliHistory = historyItems.find((item) => (
      String(item.source || '').includes('local_voice_command_cli') &&
      String(item.transcriptPreview || '').includes(localCliTranscript.slice(0, 8))
    ));
    const privacy = historyData.privacy || {};
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
        cliHistory &&
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
        ? ok('voice_command.history', 'Local voice command history', `${historyItems.length} item(s) · preview-only transcript · no audio/screenshot/clipboard/AX payload`)
        : fail('voice_command.history', 'Local voice command history', `expected sanitized local voice history, got ${history.status}`, {
            privacy,
            found: Boolean(cliHistory),
            item: cliHistory || historyItems[0] || null,
          }),
    );

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-voice-history', '--limit', '8'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      out.push(
        stdout.includes('Local Voice Command History') &&
          stdout.includes('transcript-preview-only') &&
          stdout.includes(localCliTranscript.slice(0, 8))
          ? ok('voice_command.history_cui', 'Local voice history CUI', 'CUI prints recent sanitized voice-command history')
          : fail('voice_command.history_cui', 'Local voice history CUI', 'CUI did not print the expected local voice history summary', { stdout }),
      );
    } catch (error) {
      out.push(fail('voice_command.history_cui', 'Local voice history CUI', error instanceof Error ? error.message : String(error)));
    }

    try {
      const { stdout } = await execFileAsync(process.execPath, ['scripts/config-cui.cjs', '--print-wake-handoff'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          JAVIS_API_BASE: ctx.baseUrl,
          ...(ctx.token ? { JAVIS_API_TOKEN: ctx.token } : {}),
        },
        timeout: 10000,
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
    } catch (error) {
      out.push(fail('voice_command.renderer_fallback', 'Renderer fallback wiring', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
