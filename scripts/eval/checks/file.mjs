import fs from 'node:fs';
import path from 'node:path';

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

    const fixtureDir = path.join(process.cwd(), '.javis-eval-file-workflow');
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.mkdirSync(fixtureDir, { recursive: true });
    try {
      const alpha = path.join(fixtureDir, 'Alpha Draft.txt');
      const beta = path.join(fixtureDir, 'Beta Draft.txt');
      fs.writeFileSync(alpha, 'alpha\n', 'utf8');
      fs.writeFileSync(beta, 'beta\n', 'utf8');

      const renamePlan = await ctx.api('/api/files/plan', {
        method: 'POST',
        body: {
          path: fixtureDir,
          intent: 'rename',
          extensions: ['.txt'],
          prefix: 'renamed-',
          caseStyle: 'kebab',
          maxFiles: 2,
        },
      });
      const renameSteps = Array.isArray(renamePlan.data?.steps) ? renamePlan.data.steps : [];
      out.push(
        renamePlan.ok &&
          renamePlan.data?.planIntent === 'rename' &&
          renamePlan.data?.counts?.steps === 2 &&
          renameSteps.every((step) => step.action === 'move_file') &&
          renameSteps.some((step) => String(step.plan?.args?.destinationPath || '').endsWith('renamed-alpha-draft.txt'))
          ? ok('file.rename_plan', 'Batch rename preview', '2 move_file step(s) generated without execution')
          : fail('file.rename_plan', 'Batch rename preview', `POST /api/files/plan ${renamePlan.status}`, renamePlan.data),
      );

      const renameApplyPreview = await ctx.api('/api/files/plan/apply', {
        method: 'POST',
        body: {
          path: fixtureDir,
          intent: 'rename',
          extensions: ['.txt'],
          prefix: 'renamed-',
          caseStyle: 'kebab',
          maxFiles: 2,
          confirm: false,
        },
      });
      out.push(
        renameApplyPreview.ok &&
          renameApplyPreview.data?.confirmed === false &&
          fs.existsSync(alpha) &&
          fs.existsSync(beta)
          ? ok('file.rename_apply_gate', 'Batch rename apply gate', 'confirm:false previews only and leaves files untouched')
          : fail('file.rename_apply_gate', 'Batch rename apply gate', `POST /api/files/plan/apply ${renameApplyPreview.status}`, renameApplyPreview.data),
      );

      const convertPlan = await ctx.api('/api/files/plan', {
        method: 'POST',
        body: {
          path: fixtureDir,
          intent: 'convert',
          extensions: ['.txt'],
          targetExtension: '.md',
          maxFiles: 1,
        },
      });
      const convertStep = Array.isArray(convertPlan.data?.steps) ? convertPlan.data.steps[0] : null;
      out.push(
        convertPlan.ok &&
          convertPlan.data?.planIntent === 'convert' &&
          convertPlan.data?.conversionMode === 'semantic' &&
          convertPlan.data?.counts?.steps === 1 &&
          convertStep?.action === 'write_file' &&
          convertStep.plan?.metadata?.contentRedacted === true &&
          String(convertStep.plan?.args?.path || '').endsWith('.md') &&
          !String(convertStep.plan?.args?.content || '').includes('alpha')
          ? ok('file.convert_plan', 'Semantic convert preview', '1 redacted write_file step generated')
          : fail('file.convert_plan', 'Copy-convert preview', `POST /api/files/plan ${convertPlan.status}`, convertPlan.data),
      );

      const convertApply = await ctx.api('/api/files/plan/apply', {
        method: 'POST',
        body: {
          path: fixtureDir,
          intent: 'convert',
          extensions: ['.txt'],
          targetExtension: '.md',
          maxFiles: 1,
          confirm: true,
        },
      });
      const generatedMarkdown = fs.readdirSync(fixtureDir).find((name) => name.endsWith('.md'));
      const generatedMarkdownText = generatedMarkdown ? fs.readFileSync(path.join(fixtureDir, generatedMarkdown), 'utf8') : '';
      out.push(
        convertApply.ok &&
          convertApply.data?.confirmed === true &&
          convertApply.data?.counts?.executed === 1 &&
          generatedMarkdown &&
          /^# .+ Draft/m.test(generatedMarkdownText) &&
          /alpha|beta/.test(generatedMarkdownText)
          ? ok('file.convert_apply', 'Semantic convert apply', 'confirmed plan wrote Markdown through file action policy')
          : fail('file.convert_apply', 'Copy-convert apply', `POST /api/files/plan/apply ${convertApply.status}`, convertApply.data),
      );

      const copyConvertPlan = await ctx.api('/api/files/plan', {
        method: 'POST',
        body: {
          path: fixtureDir,
          intent: 'convert',
          extensions: ['.txt'],
          targetExtension: '.copy',
          conversionMode: 'copy',
          maxFiles: 1,
        },
      });
      const copyConvertStep = Array.isArray(copyConvertPlan.data?.steps) ? copyConvertPlan.data.steps[0] : null;
      out.push(
        copyConvertPlan.ok &&
          copyConvertPlan.data?.planIntent === 'convert' &&
          copyConvertPlan.data?.conversionMode === 'copy' &&
          copyConvertStep?.action === 'copy_file' &&
          String(copyConvertStep.plan?.args?.destinationPath || '').endsWith('.copy')
          ? ok('file.convert_copy_mode', 'Copy-convert mode', 'conversionMode:copy still generates a non-destructive copy_file step')
          : fail('file.convert_copy_mode', 'Copy-convert mode', `POST /api/files/plan ${copyConvertPlan.status}`, copyConvertPlan.data),
      );
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }

    return out;
  },
};
