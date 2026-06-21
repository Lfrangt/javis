import { ok, warn, fail } from '../_client.mjs';

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

    return out;
  },
};
