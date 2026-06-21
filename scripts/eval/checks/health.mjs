import { ok, warn, fail, assert } from '../_client.mjs';

export default {
  lane: 'health',
  async run(ctx) {
    const out = [];

    const health = await ctx.api('/api/health');
    out.push(assert(health.ok, 'health.up', 'Service health', `GET /api/health ${health.status}`, `health ${health.status} ${health.error || ''}`));

    const petStatus = await ctx.api('/api/pet/status', { timeoutMs: 5000 });
    const latencyThresholdMs = 2000;
    out.push(
      health.ok &&
        petStatus.ok &&
        health.elapsedMs <= latencyThresholdMs &&
        petStatus.elapsedMs <= latencyThresholdMs &&
        petStatus.data?.pet?.lightweight === true
        ? ok('health.status_latency', 'Status endpoint latency', `health=${health.elapsedMs}ms · pet=${petStatus.elapsedMs}ms`)
        : fail('health.status_latency', 'Status endpoint latency', `expected health and pet status under ${latencyThresholdMs}ms, got health=${health.elapsedMs ?? '-'}ms pet=${petStatus.elapsedMs ?? '-'}ms`, {
            health: { status: health.status, elapsedMs: health.elapsedMs },
            pet: { status: petStatus.status, elapsedMs: petStatus.elapsedMs },
          }),
    );

    const rendererStatus = await ctx.api('/api/renderer/status', { timeoutMs: 5000 });
    const renderer = rendererStatus.data?.renderer || {};
    const healthRenderer = health.data?.renderer || {};
    const rendererRaw = JSON.stringify({ renderer, healthRenderer });
    const rendererStatuses = new Set(['ready', 'loading', 'recovering', 'degraded', 'missing_window', 'unknown']);
    out.push(
      rendererStatus.ok &&
        renderer.version === 1 &&
        healthRenderer.version === 1 &&
        rendererStatuses.has(renderer.status) &&
        healthRenderer.status === renderer.status &&
        typeof renderer.windowPresent === 'boolean' &&
        typeof renderer.loaded === 'boolean' &&
        typeof renderer.recoveryPending === 'boolean' &&
        typeof renderer.recoveryAttempts === 'number' &&
        typeof renderer.loadAttemptCount === 'number' &&
        renderer.timestamps &&
        renderer.agesMs &&
        !rendererRaw.includes('javisApiToken') &&
        !rendererRaw.includes('OPENAI_API_KEY')
        ? ok('health.renderer_status_contract', 'Renderer health contract', `${renderer.status} · attempts=${renderer.loadAttemptCount} · recoveryPending=${renderer.recoveryPending}`)
        : fail('health.renderer_status_contract', 'Renderer health contract', 'expected renderer health in /api/health and /api/renderer/status without token leakage', {
            status: rendererStatus.status,
            renderer,
            healthRenderer,
          }),
    );
    out.push(
      rendererStatus.ok &&
        renderer.ok === true &&
        renderer.status === 'ready' &&
        renderer.windowPresent === true &&
        renderer.loaded === true &&
        renderer.recoveryPending === false
        ? ok('health.renderer_ready', 'Renderer ready', `${renderer.mode || '-'} · loaded=${renderer.timestamps?.loadedAt || '-'}`)
        : fail('health.renderer_ready', 'Renderer ready', 'expected current resident renderer to be loaded and not recovering', {
            status: rendererStatus.status,
            renderer,
          }),
    );

    const auditStatus = await ctx.api('/api/audit/status');
    const audit = auditStatus.data?.audit || health.data?.storage?.audit || {};
    out.push(
      auditStatus.ok &&
        audit.file &&
        audit.bounded === true &&
        Number(audit.currentBytes || 0) <= Number(audit.maxBytes || 0) &&
        Number(audit.retainBytes || 0) > 0 &&
        Number(audit.archiveCount || 0) <= Number(audit.archiveLimit || 0)
        ? ok('health.audit_storage', 'Audit storage retention', `current=${Math.round(Number(audit.currentBytes || 0) / 1024)}KB · archives=${audit.archiveCount}/${audit.archiveLimit}`)
        : fail('health.audit_storage', 'Audit storage retention', 'audit log is not bounded or status is unavailable', audit),
    );

    const doctor = await ctx.api('/api/doctor/report', { timeoutMs: 45000 });
    const report = doctor.data?.doctor;
    if (report) {
      const counts = report.counts || {};
      const blocked = Number(counts.blocked || 0);
      const perceptionCheck = (report.checks || []).find((check) => check.id === 'perception_consent_registry');
      out.push(
        blocked === 0
          ? ok('health.doctor', 'Doctor report', `${counts.ready || 0} ready · ${counts.warning || 0} warning · 0 blocked (${(report.checks || []).length} checks)`, { counts })
          : warn('health.doctor', 'Doctor report', `${blocked} blocked check(s): ${(report.checks || []).filter((c) => c.status === 'blocked').map((c) => c.id).join(', ')}`, { counts }),
      );
      out.push(
        perceptionCheck && perceptionCheck.status === 'ready'
          ? ok('health.doctor_perception_consent', 'Doctor perception consent', perceptionCheck.summary || 'perception consent registry ready')
          : fail('health.doctor_perception_consent', 'Doctor perception consent', 'doctor must include a ready perception consent registry check', perceptionCheck || {}),
      );
    } else {
      out.push(fail('health.doctor', 'Doctor report', `GET /api/doctor/report ${doctor.status} ${doctor.error || ''}`));
    }

    const readiness = await ctx.api('/api/readiness');
    const ready = readiness.data?.readiness || readiness.data;
    out.push(
      readiness.ok && ready
        ? ok('health.readiness', 'Readiness', `overall=${ready.overall || ready.status || 'ok'}`, undefined)
        : warn('health.readiness', 'Readiness', `GET /api/readiness ${readiness.status} ${readiness.error || ''}`),
    );

    const config = await ctx.api('/api/config/check');
    const cfg = config.data?.config || config.data?.check || config.data;
    out.push(
      config.ok && cfg
        ? ok('health.config', 'Config validator', cfg.ok === false ? `issues: ${(cfg.issues || []).length}` : 'config valid', undefined)
        : warn('health.config', 'Config validator', `GET /api/config/check ${config.status} ${config.error || ''}`),
    );

    return out;
  },
};
