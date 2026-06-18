import { ok, warn, fail } from '../_client.mjs';

export default {
  lane: 'file',
  async run(ctx) {
    const out = [];

    const list = await ctx.api('/api/files/execute', {
      method: 'POST',
      body: { action: 'list_directory', path: '.', maxEntries: 8 },
    });
    let parsed = null;
    try {
      parsed = typeof list.data?.output === 'string' ? JSON.parse(list.data.output) : null;
    } catch {
      parsed = null;
    }
    out.push(
      list.ok && parsed && Array.isArray(parsed.entries)
        ? ok('file.list', 'Directory list', `${parsed.entries.length} entry sample(s) from ${parsed.path || '.'}`)
        : fail('file.list', 'Directory list', `list_directory ${list.status} ${list.error || list.data?.error || ''}`),
    );

    const search = await ctx.api('/api/files/execute', {
      method: 'POST',
      body: { action: 'search_files', path: '.', query: 'JAVIS', maxResults: 5 },
      timeoutMs: 15000,
    });
    let searchParsed = null;
    try {
      searchParsed = typeof search.data?.output === 'string' ? JSON.parse(search.data.output) : null;
    } catch {
      searchParsed = null;
    }
    out.push(
      search.ok && searchParsed && Array.isArray(searchParsed.results)
        ? ok('file.search', 'File search', `${searchParsed.results.length} match sample(s)`)
        : warn('file.search', 'File search', `search_files ${search.status} ${search.error || search.data?.error || ''}`),
    );

    const plan = await ctx.api('/api/files/plan', {
      method: 'POST',
      body: { path: '.', maxEntries: 12, maxMoves: 5 },
    });
    out.push(
      plan.ok && plan.data?.counts
        ? ok('file.plan', 'Organization preview', `${plan.data.counts.steps || 0} planned step(s), ${plan.data.counts.blocked || 0} blocked`)
        : warn('file.plan', 'Organization preview', `preview ${plan.status} ${plan.error || plan.data?.error || ''}`),
    );

    return out;
  },
};
