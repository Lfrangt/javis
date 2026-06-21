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
        transcript: '看一下我当前窗口，告诉我应该走哪个工作通道，先不要执行。',
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

    const quickHeld = await ctx.api('/api/voice/command', {
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
        "printf '/status\\n/app\\n/ui 打开 Calculator 然后关闭窗口\\n/file list .\\n/file organize .\\n/browser\\n/browse extract_actions 提取当前网页行动项，先预览。\\n/open https://example.com\\n/delegate codex scope docs/ROADMAP.md access read Read-only inspect docs/ROADMAP.md and return two bullets. Do not write files.\\n/jobs\\n/progress\\n/next\\n/history\\n/agent 检查 JAVIS 状态，先不要执行。\\n状态\\n继续刚才那个\\n/exit\\n' | JAVIS_LOCAL_VOICE_CLI=true node scripts/local-voice-command-dogfood.mjs --chat --json --no-speech --no-session --no-screen --no-ui --request-timeout-ms 20000",
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
      const statusTurn = commandTurns.find((turn) => turn.command === 'status') || {};
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
          loop.turnCount === 16 &&
          loop.previewOnly === true &&
          loop.safety?.startsMicrophone === false &&
          loop.safety?.usesRealtime === false &&
          loop.safety?.storesRawAudio === false &&
          commandTurns.length === 14 &&
          ['status', 'app', 'ui', 'file', 'browser', 'browse', 'open', 'delegate', 'jobs', 'progress', 'next', 'history', 'agent'].every((command) => commandTurns.some((turn) => turn.command === command)) &&
          statusTurn.detailLevel === 'fast' &&
          statusTurn.endpoint === '/api/pet/status' &&
          statusTurn.output.includes('Pet:') &&
          appTurn.detailLevel === 'fast' &&
          appTurn.endpoint === '/api/mac/context + /api/accessibility/tree?maxNodes=40&maxDepth=4' &&
          appTurn.output.includes('App:') &&
          appTurn.output.includes('UI:') &&
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
          browserTurn.endpoint === '/api/browser/context + /api/browser/page?maxChars=1200' &&
          browserTurn.output.includes('Browser:') &&
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
        transcript: '继续刚才那个',
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
        ? ok('voice_command.continue_last_route', 'Voice continue last route', `${localContinueRouteId} continued through local command without quick cloud call`)
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

    const sessionTranscript = '把这条本地语音指令记到工作会话，先不要执行。';
    let cleanupSessionId = '';
    try {
      const sessionsBefore = await ctx.api('/api/sessions?limit=1', { timeoutMs: 10000 });
      let targetSession = sessionsBefore.data?.sessions?.active || null;
      const activeLooksLikeEval = targetSession && (
        targetSession.source === 'eval_voice_command_session_ledger' ||
        String(targetSession.goal || '').startsWith('eval local voice session ledger')
      );
      if (activeLooksLikeEval) cleanupSessionId = targetSession.id;
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

      out.push(
        targetSession?.id &&
          sessionVoice.ok &&
          sessionVoice.data?.ok === true &&
          sessionData.recorded === true &&
          sessionData.sessionId === targetSession.id &&
          sessionData.eventId &&
          sessionData.eventType === 'voice_command' &&
          sessionData.privacy?.transcriptPreviewOnly === true &&
          sessionData.privacy?.noRawAudio === true &&
          sessionData.privacy?.noScreenImages === true &&
          sessionData.privacy?.noClipboardText === true &&
          sessionData.privacy?.noAccessibilityNodes === true &&
          !hasForbiddenHistoryPayload(sessionData) &&
          sessionVoice.data?.route?.routing?.id
          ? ok('voice_command.session_ledger', 'Voice command session ledger', `${sessionData.title || targetSession.title} recorded event ${sessionData.eventId}`)
          : fail('voice_command.session_ledger', 'Voice command session ledger', 'voice command did not append a sanitized work-session event', {
              targetSession,
              sessionVoice: sessionVoice.data,
            }),
      );
    } catch (error) {
      if (cleanupSessionId) {
        await ctx.api(`/api/sessions/${encodeURIComponent(cleanupSessionId)}`, {
          method: 'DELETE',
          timeoutMs: 10000,
        });
      }
      out.push(fail('voice_command.session_ledger', 'Voice command session ledger', error instanceof Error ? error.message : String(error)));
    }

    const history = await ctx.api('/api/voice/history?limit=50&auditLimit=200', { timeoutMs: 30000 });
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
    } catch (error) {
      out.push(fail('voice_command.renderer_fallback', 'Renderer fallback wiring', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
