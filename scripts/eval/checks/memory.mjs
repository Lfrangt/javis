import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'memory',
  async run(ctx) {
    const out = [];

    const list = await ctx.api('/api/memory');
    const memory = list.data?.memory || {};
    const records = memory.results || list.data?.memories || list.data?.records || (Array.isArray(list.data) ? list.data : null);
    if (!list.ok || !Array.isArray(records)) {
      out.push(fail('memory.list', 'Memory store', `GET /api/memory ${list.status} ${list.error || ''}`));
      return out;
    }
    out.push(ok('memory.list', 'Memory store', `${records.length} returned · ${memory.total ?? records.length} total explicit memory record(s)`));

    // Read-only search probe.
    const search = await ctx.api('/api/memory?query=test&limit=3');
    const results = search.data?.memory?.results || search.data?.results || search.data?.memories;
    out.push(
      search.ok
        ? ok('memory.search', 'Memory search', `query returned ${Array.isArray(results) ? results.length : 0} match(es)`)
        : warn('memory.search', 'Memory search', `search ${search.status} ${search.error || ''}`),
    );

    return out;
  },
};
