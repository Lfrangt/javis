import { ok, warn, fail, skip } from '../_client.mjs';

// Read-only surface state the coverage report flagged as actionable GET gaps:
// the macOS menu bar status item (README: "macOS menu bar status item for
// resident controls"), learned shortcuts (README: "turn repeated successful
// workflows into suggested … shortcuts"), exported learning skills, and the
// knowledge/Obsidian vault index (README: "Obsidian/MCP bridge"). All read-only.
export default {
  lane: 'surface',
  async run(ctx) {
    const out = [];

    const menubar = await ctx.api('/api/menubar/state');
    const mb = menubar.data?.menuBar;
    out.push(
      menubar.ok && mb && typeof mb.available === 'boolean'
        ? ok('surface.menubar', 'Menu bar status item', `available=${mb.available}${mb.updatedAt ? ` · updated ${new Date(mb.updatedAt).toISOString().slice(11, 19)}` : ''}`)
        : warn('surface.menubar', 'Menu bar status item', `GET /api/menubar/state ${menubar.status} ${menubar.error || ''}`),
    );

    const shortcuts = await ctx.api('/api/shortcuts');
    const sc = shortcuts.data?.shortcuts;
    out.push(
      shortcuts.ok && sc && Array.isArray(sc.items)
        ? ok('surface.shortcuts', 'Learned shortcuts', `${sc.counts?.total ?? sc.items.length} shortcut(s)`)
        : warn('surface.shortcuts', 'Learned shortcuts', `GET /api/shortcuts ${shortcuts.status} ${shortcuts.error || ''}`),
    );

    const candidates = await ctx.api('/api/shortcuts/candidates?limit=5');
    const cand = candidates.data?.candidates;
    out.push(
      candidates.ok && cand && Array.isArray(cand.items)
        ? ok('surface.shortcut_candidates', 'Shortcut candidates', `${cand.count ?? cand.items.length} suggested from repeated workflows`)
        : warn('surface.shortcut_candidates', 'Shortcut candidates', `GET /api/shortcuts/candidates ${candidates.status} ${candidates.error || ''}`),
    );

    const skills = await ctx.api('/api/learning/skills');
    const sk = skills.data?.skills;
    out.push(
      skills.ok && sk && Array.isArray(sk.results)
        ? ok('surface.learning_skills', 'Exported learning skills', `${sk.total ?? sk.results.length} skill(s) under ${sk.root ? '…/' + String(sk.root).split('/').slice(-2).join('/') : 'skills root'}`)
        : warn('surface.learning_skills', 'Exported learning skills', `GET /api/learning/skills ${skills.status} ${skills.error || ''}`),
    );

    const vaults = await ctx.api('/api/knowledge/vaults');
    const v = vaults.data?.vaults;
    out.push(
      vaults.ok && v && Array.isArray(v.candidates)
        ? ok('surface.knowledge_vaults', 'Knowledge vaults', `${v.total ?? v.candidates.length} Obsidian/knowledge vault candidate(s)`)
        : warn('surface.knowledge_vaults', 'Knowledge vaults', `GET /api/knowledge/vaults ${vaults.status} ${vaults.error || ''}`),
    );

    const capabilityId = 'realtime';
    const capability = await ctx.api(`/api/capabilities/${capabilityId}`);
    const cap = capability.data?.capabilities;
    const capItems = cap?.capabilities || [];
    out.push(
      capability.ok && cap?.ok === true && Array.isArray(capItems) && capItems.length === 1 && capItems[0]?.id === 'realtime'
        ? ok('surface.capability_detail', 'Capability detail', `${capItems[0].id}=${capItems[0].status || 'unknown'} · owner=${capItems[0].owner || 'unknown'}`)
        : fail('surface.capability_detail', 'Capability detail', 'GET /api/capabilities/realtime did not return the realtime capability contract', capability.data || { status: capability.status, error: capability.error }),
    );

    const laneContractId = 'realtime';
    const laneContract = await ctx.api(`/api/lanes/contracts/${laneContractId}`);
    const contract = laneContract.data?.laneContracts;
    const contractItems = contract?.contracts || [];
    out.push(
      laneContract.ok && contract?.ok === true && Array.isArray(contractItems) && contractItems.length === 1 && contractItems[0]?.id === 'realtime'
        ? ok('surface.lane_contract_detail', 'Lane contract detail', `${contractItems[0].id} · handoff=${contractItems[0].handoff?.defaultLane || 'unknown'}`)
        : fail('surface.lane_contract_detail', 'Lane contract detail', 'GET /api/lanes/contracts/realtime did not return the realtime lane contract', laneContract.data || { status: laneContract.status, error: laneContract.error }),
    );

    const attention = await ctx.api('/api/attention/history');
    const history = attention.data?.history;
    out.push(
      attention.ok && history?.ok === true && history.operatorOnly === true && history.desktopPet === false && Array.isArray(history.recent)
        ? ok('surface.attention_history', 'Attention history', `${history.returned ?? history.recent.length}/${history.count ?? 0} operator-only event(s)`)
        : fail('surface.attention_history', 'Attention history', 'attention history must stay operator-only and off the desktop pet', attention.data || { status: attention.status, error: attention.error }),
    );

    const productivityArchives = await ctx.api('/api/productivity/dogfood/archives');
    const prodArchives = productivityArchives.data?.archives;
    out.push(
      productivityArchives.ok && prodArchives?.ok === true && Array.isArray(prodArchives.items)
        ? ok('surface.productivity_archives', 'Productivity dogfood archives', `${prodArchives.count ?? prodArchives.items.length} archive(s) · max=${prodArchives.maxArchives || 'unknown'}`)
        : fail('surface.productivity_archives', 'Productivity dogfood archives', 'GET /api/productivity/dogfood/archives did not return an archive index', productivityArchives.data || { status: productivityArchives.status, error: productivityArchives.error }),
    );

    const realtimeArchives = await ctx.api('/api/realtime/dogfood/archives');
    const rtArchives = realtimeArchives.data?.archives;
    out.push(
      realtimeArchives.ok && rtArchives?.ok === true && Array.isArray(rtArchives.items)
        ? ok('surface.realtime_archives', 'Realtime dogfood archives', `${rtArchives.count ?? rtArchives.items.length} archive(s) · max=${rtArchives.maxArchives || 'unknown'}`)
        : fail('surface.realtime_archives', 'Realtime dogfood archives', 'GET /api/realtime/dogfood/archives did not return an archive index', realtimeArchives.data || { status: realtimeArchives.status, error: realtimeArchives.error }),
    );

    const teachingPacketResponse = await ctx.api('/api/record-replay/teaching-packet');
    const teachingPacket = teachingPacketResponse.data?.teachingPacket;
    out.push(
      teachingPacketResponse.ok &&
        teachingPacket?.ok === true &&
        teachingPacket.kind === 'record_replay_teaching_packet' &&
        teachingPacket.saved === false &&
        teachingPacket.safety?.previewOnly === true &&
        teachingPacket.safety?.executesTask === false &&
        teachingPacket.safety?.startsRecording === false
        ? ok('surface.record_replay_teaching_packet', 'Record & Replay teaching packet', teachingPacket.summary || 'prepared without recording or replay')
        : fail('surface.record_replay_teaching_packet', 'Record & Replay teaching packet', 'teaching packet must be read-only, unsaved, and non-executing by default', teachingPacketResponse.data || { status: teachingPacketResponse.status, error: teachingPacketResponse.error }),
    );

    const privacyPresetId = 'sensitive_defaults';
    const privacyPreset = await ctx.api(`/api/screen/privacy/presets/${privacyPresetId}`);
    const presetPreview = privacyPreset.data?.preview;
    out.push(
      privacyPreset.ok && presetPreview?.ok === true && presetPreview.dryRun === true && presetPreview.preset?.id === 'sensitive_defaults'
        ? ok('surface.privacy_preset_detail', 'Screen privacy preset detail', `${presetPreview.preset.id} · wouldAdd=${presetPreview.counts?.wouldAdd ?? 0} · next=${presetPreview.counts?.nextTotal ?? '?'}`)
        : fail('surface.privacy_preset_detail', 'Screen privacy preset detail', 'privacy preset detail must be a dry-run preview', privacyPreset.data || { status: privacyPreset.status, error: privacyPreset.error }),
    );

    const regionPresetId = 'notch_band';
    const regionPreset = await ctx.api(`/api/screen/privacy/region-presets/${regionPresetId}`);
    const regionPreview = regionPreset.data?.preview;
    out.push(
      regionPreset.ok && regionPreview?.ok === true && regionPreview.dryRun === true && regionPreview.preset?.id === 'notch_band' && regionPreview.rule?.kind === 'region'
        ? ok('surface.region_preset_detail', 'Screen region preset detail', `${regionPreview.preset.id} · ${regionPreview.rule.region?.width || '?'}x${regionPreview.rule.region?.height || '?'}%`)
        : fail('surface.region_preset_detail', 'Screen region preset detail', 'region preset detail must be a dry-run region-mask preview', regionPreset.data || { status: regionPreset.status, error: regionPreset.error }),
    );

    const windowBeforeResponse = await ctx.api('/api/window/state');
    const windowBefore = windowBeforeResponse.data?.window || {};
    const beforePosition = windowBefore.position || {};
    if (
      windowBeforeResponse.ok &&
      Number.isFinite(Number(beforePosition.x)) &&
      Number.isFinite(Number(beforePosition.y))
    ) {
      const targetX = Math.max(0, Math.round(Number(beforePosition.x) + (Number(beforePosition.x) > 80 ? -24 : 24)));
      const targetY = Math.max(0, Math.round(Number(beforePosition.y) + 24));
      const movedResponse = await ctx.api('/api/window/move', {
        method: 'POST',
        body: { x: targetX, y: targetY },
      });
      const moved = movedResponse.data?.window || {};
      const movedPosition = moved.position || {};
      const restoreResponse = await ctx.api('/api/window/park', {
        method: 'POST',
        body: {
          corner: windowBefore.parkCorner || 'notch',
          display: windowBefore.parkDisplay || 'primary',
        },
      });
      const restored = restoreResponse.data?.window || {};
      const movedCloseEnough =
        Math.abs(Number(movedPosition.x) - targetX) <= 2 &&
        Math.abs(Number(movedPosition.y) - targetY) <= 2;
      out.push(
        movedResponse.ok &&
          movedResponse.data?.ok === true &&
          moved.mode === windowBefore.mode &&
          movedCloseEnough &&
          restoreResponse.ok &&
          restoreResponse.data?.ok === true &&
          restored.parkCorner === (windowBefore.parkCorner || 'notch')
          ? ok('surface.window_move_restore', 'Pet window move and restore', `moved ${targetX},${targetY} · restored=${restored.parkCorner}`)
          : fail('surface.window_move_restore', 'Pet window move and restore', 'window move should only reposition JAVIS, preserve mode, and restore the parked corner', {
            before: windowBefore,
            moved: movedResponse.data || { status: movedResponse.status, error: movedResponse.error },
            restored: restoreResponse.data || { status: restoreResponse.status, error: restoreResponse.error },
          }),
      );
    } else {
      out.push(fail('surface.window_move_restore', 'Pet window move and restore', 'GET /api/window/state did not expose a current JAVIS window position', windowBeforeResponse.data || { status: windowBeforeResponse.status, error: windowBeforeResponse.error }));
    }

    const hideWindowResponse = await ctx.api('/api/window/hide', {
      method: 'POST',
      body: { source: 'eval_surface_hide_pet' },
    });
    const hiddenWindow = hideWindowResponse.data?.window || {};
    const showWindowResponse = await ctx.api('/api/window/show', {
      method: 'POST',
      body: { source: 'eval_surface_show_pet', focus: false, park: true },
    });
    const shownWindow = showWindowResponse.data?.window || {};
    out.push(
      hideWindowResponse.ok &&
        hideWindowResponse.data?.ok === true &&
        hiddenWindow.surface === 'hidden' &&
        hiddenWindow.hidden === true &&
        hiddenWindow.visible === false &&
        hiddenWindow.classroomMode?.active === true &&
        hiddenWindow.safety?.startsMicrophone === false &&
        hiddenWindow.safety?.usesRealtime === false &&
        hiddenWindow.safety?.callsOpenAI === false &&
        hiddenWindow.safety?.stopsResident === false &&
        showWindowResponse.ok &&
        showWindowResponse.data?.ok === true &&
        shownWindow.surface === 'visible' &&
        shownWindow.visible === true &&
        shownWindow.hidden === false &&
        shownWindow.closed === false
        ? ok('surface.window_hide_show', 'Pet hide/show classroom mode', `hidden=${hiddenWindow.surface} · restored=${shownWindow.surface}`)
        : fail('surface.window_hide_show', 'Pet hide/show classroom mode', 'desktop pet should hide without stopping resident services and restore visibly afterward', {
          hidden: hideWindowResponse.data || { status: hideWindowResponse.status, error: hideWindowResponse.error },
          shown: showWindowResponse.data || { status: showWindowResponse.status, error: showWindowResponse.error },
        }),
    );

    const workflows = await ctx.api('/api/workflows');
    const workflowItems = workflows.data?.workflows || [];
    if (workflows.ok && Array.isArray(workflowItems) && workflowItems[0]?.id) {
      const workflowDetail = await ctx.api(`/api/workflows/${workflowItems[0].id}`);
      const workflow = workflowDetail.data?.workflow;
      out.push(
        workflowDetail.ok && workflow?.id === workflowItems[0].id
          ? ok('surface.workflow_detail', 'Workflow detail', `${workflow.kind || 'workflow'} · ${workflow.status || 'unknown'} · ${workflow.id.slice(0, 8)}`)
          : fail('surface.workflow_detail', 'Workflow detail', 'GET /api/workflows/:id did not return the requested workflow', workflowDetail.data || { status: workflowDetail.status, error: workflowDetail.error }),
      );
    } else {
      out.push(skip('surface.workflow_detail', 'Workflow detail', 'no workflow history item available to read by id'));
    }

    return out;
  },
};
