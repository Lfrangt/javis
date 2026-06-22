import { ok, warn, fail } from '../_client.mjs';

// Read-only-by-semantics POST searches (HTTP POST but they mutate nothing):
// the Obsidian/knowledge vault search (README: "Obsidian/MCP bridge for notes
// and knowledge work") and the local skills search. The coverage report lists
// these under mutation routes by method, but they are safe to smoke-test.
export default {
  lane: 'knowledge-search',
  async run(ctx) {
    const out = [];

    const knowledge = await ctx.api('/api/knowledge/search', {
      method: 'POST',
      body: { query: 'javis', limit: 3 },
      timeoutMs: 15000,
    });
    const k = knowledge.data;
    out.push(
      knowledge.ok && k && k.ok !== false && Array.isArray(k.results)
        ? ok('knowledge.search', 'Knowledge vault search', `${k.returned ?? k.results.length} result(s) from ${k.totalFilesScanned ?? '?'} file(s)${k.vault?.name ? ` · vault=${k.vault.name}` : ''}`)
        : warn('knowledge.search', 'Knowledge vault search', `POST /api/knowledge/search ${knowledge.status} ${knowledge.error || k?.error || '(no vault configured is ok)'}`),
    );

    const skills = await ctx.api('/api/skills/local/search', {
      method: 'POST',
      body: { query: 'workflow', limit: 3 },
      timeoutMs: 15000,
    });
    const s = skills.data?.skills;
    out.push(
      skills.ok && s && s.ok !== false && Array.isArray(s.results)
        ? ok('knowledge.skills_search', 'Local skills search', `${s.returned ?? s.results.length}/${s.total ?? '?'} skill(s) matched`)
        : warn('knowledge.skills_search', 'Local skills search', `POST /api/skills/local/search ${skills.status} ${skills.error || s?.error || ''}`),
    );

    return out;
  },
};
