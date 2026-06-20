import { ok, fail } from '../_client.mjs';
import { runRealtimePayloadAudit } from '../../realtime-payload-audit.mjs';

export default {
  lane: 'realtime-payload',
  async run(ctx) {
    const report = await runRealtimePayloadAudit(ctx);
    const out = [];
    const largest = report.largest;
    out.push(
      report.ok
        ? ok(
          'realtime_payload.budget',
          'Realtime voice payload budget',
          `${report.counts.pass}/${report.counts.total} tool payload(s) within budget; largest ${largest?.id || 'none'} ${largest?.bytes || 0}B`,
          { largest, results: report.results },
        )
        : fail(
          'realtime_payload.budget',
          'Realtime voice payload budget',
          `${report.counts.fail} payload budget failure(s)`,
          report.results.filter((result) => !result.ok),
        ),
    );
    const compactMissing = report.results.filter((result) => result.maxBytes >= 10000 && !result.compact && result.id !== 'realtime_evidence');
    out.push(
      compactMissing.length === 0
        ? ok('realtime_payload.compact', 'Realtime compact payload markers', 'voice-heavy tools expose compact responseBudget metadata')
        : fail('realtime_payload.compact', 'Realtime compact payload markers', `missing compact metadata: ${compactMissing.map((result) => result.id).join(', ')}`, compactMissing),
    );
    return out;
  },
};
