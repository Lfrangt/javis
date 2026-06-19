import { ok, warn, fail, assert } from '../_client.mjs';

export default {
  lane: 'health',
  async run(ctx) {
    const out = [];

    const health = await ctx.api('/api/health');
    out.push(assert(health.ok, 'health.up', 'Service health', `GET /api/health ${health.status}`, `health ${health.status} ${health.error || ''}`));

    const doctor = await ctx.api('/api/doctor/report', { timeoutMs: 20000 });
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
