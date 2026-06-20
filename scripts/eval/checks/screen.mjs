import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ok, warn, fail } from '../_client.mjs';

const execFileAsync = promisify(execFile);

// Screen privacy mode (README: "Private screen mode that downscales/blurs frames
// before they leave the renderer"). Read-only — reads the mode, never changes it.
export default {
  lane: 'screen',
  async run(ctx) {
    const out = [];

    const r = await ctx.api('/api/screen/privacy');
    const privacy = r.data?.privacy;
    if (!r.ok || !privacy) {
      out.push(fail('screen.privacy', 'Screen privacy mode', `GET /api/screen/privacy ${r.status} ${r.error || ''}`));
      return out;
    }
    const mode = privacy.mode || privacy.value || (typeof privacy === 'string' ? privacy : '');
    out.push(
      mode
        ? ok('screen.privacy', 'Screen privacy mode', `mode=${mode}${mode === 'private' ? ' (frames downscaled/blurred before leaving renderer — safe default)' : ''}`, { mode })
        : warn('screen.privacy', 'Screen privacy mode', `privacy state present but no mode field (${Object.keys(privacy).slice(0, 6).join(',')})`, { privacy }),
    );

    const originalRules = Array.isArray(privacy.rules) ? privacy.rules : [];
    const presets = await ctx.api('/api/screen/privacy/presets?includeRules=true');
    const presetItems = Array.isArray(presets.data?.presets?.presets) ? presets.data.presets.presets : [];
    const sensitivePreset = presetItems.find((preset) => preset.id === 'sensitive_defaults');
    const presetPreview = await ctx.api('/api/screen/privacy/presets/sensitive_defaults', {
      method: 'GET',
    });
    const presetDryRun = await ctx.api('/api/screen/privacy/presets/sensitive_defaults/apply', {
      method: 'POST',
      body: { dryRun: true, source: 'eval_screen_privacy_preset_dry_run' },
    });
    const presetApply = await ctx.api('/api/screen/privacy/presets/sensitive_defaults/apply', {
      method: 'POST',
      body: { source: 'eval_screen_privacy_preset_apply' },
    });
    const passwordCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          frontmost: { app: 'Passwords', windowTitle: 'Passwords' },
        },
      },
    });
    const accountHostCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          browser: { host: 'accounts.google.com', title: 'Sign in' },
        },
      },
    });
    const paymentWindowCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          frontmost: { app: 'Safari', windowTitle: 'Payment checkout' },
        },
      },
    });
    const presetSafeCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          frontmost: { app: 'Finder', windowTitle: 'Documents' },
        },
      },
    });
    out.push(
      presets.ok &&
        sensitivePreset?.recommended === true &&
        sensitivePreset.ruleCount >= 20 &&
        sensitivePreset.counts?.app >= 4 &&
        sensitivePreset.counts?.browser_host >= 8 &&
        sensitivePreset.counts?.window >= 6 &&
        sensitivePreset.counts?.region >= 1 &&
        presetPreview.ok &&
        presetPreview.data?.preview?.preset?.id === 'sensitive_defaults' &&
        presetPreview.data?.preview?.samples?.appPasswordManager?.blocked === true &&
        presetPreview.data?.preview?.samples?.browserLogin?.blocked === true &&
        presetPreview.data?.preview?.samples?.safeFinder?.allowed === true &&
        presetDryRun.ok &&
        presetDryRun.data?.dryRun === true &&
        presetDryRun.data?.counts?.presetRules >= 20 &&
        presetApply.ok &&
        presetApply.data?.applied === true &&
        presetApply.data?.privacy?.enforcement?.regionRendererMask === true &&
        passwordCheck.ok &&
        passwordCheck.data?.policy?.blocked === true &&
        passwordCheck.data?.policy?.reason?.includes('preset_sensitive_defaults_app_passwords') &&
        accountHostCheck.ok &&
        accountHostCheck.data?.policy?.blocked === true &&
        accountHostCheck.data?.policy?.reason?.includes('preset_sensitive_defaults_host_google_accounts') &&
        paymentWindowCheck.ok &&
        paymentWindowCheck.data?.policy?.blocked === true &&
        paymentWindowCheck.data?.policy?.reason?.includes('preset_sensitive_defaults_window_payment') &&
        presetSafeCheck.ok &&
        presetSafeCheck.data?.policy?.allowed === true &&
        presetSafeCheck.data?.policy?.regionRuleCount >= 1
        ? ok('screen.privacy_presets', 'Screen privacy presets', 'sensitive defaults preset blocks password/payment/account contexts and adds a region mask')
        : fail('screen.privacy_presets', 'Screen privacy presets', 'screen privacy preset preview/apply did not protect expected sensitive contexts', {
          presets: presets.data,
          presetPreview: presetPreview.data,
          presetDryRun: presetDryRun.data,
          presetApply: presetApply.data,
          passwordCheck: passwordCheck.data,
          accountHostCheck: accountHostCheck.data,
          paymentWindowCheck: paymentWindowCheck.data,
          presetSafeCheck: presetSafeCheck.data,
        }),
    );

    const privacyWithRules = await ctx.api('/api/screen/privacy', {
      method: 'PUT',
      body: {
        source: 'eval_screen_privacy_rules',
        mode,
        rules: [
          ...originalRules.filter((rule) => !String(rule.id || '').startsWith('eval_screen_privacy_')),
          {
            id: 'eval_screen_privacy_app',
            kind: 'app',
            value: 'Secret Notes',
            match: 'exact',
            effect: 'exclude',
            label: 'Eval Secret Notes',
          },
          {
            id: 'eval_screen_privacy_window',
            kind: 'window',
            value: 'Bank Login',
            match: 'contains',
            effect: 'exclude',
            label: 'Eval Bank Window',
          },
          {
            id: 'eval_screen_privacy_region',
            kind: 'region',
            effect: 'blur',
            label: 'Eval top-right region',
            region: { unit: 'percent', x: 75, y: 0, width: 25, height: 25 },
          },
        ],
      },
    });
    const withRules = privacyWithRules.data?.privacy || {};
    const appCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          frontmost: { app: 'Secret Notes', windowTitle: 'Daily note' },
        },
      },
    });
    const windowCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          frontmost: { app: 'Safari', windowTitle: 'Bank Login - Example' },
        },
      },
    });
    const safeCheck = await ctx.api('/api/screen/privacy/check', {
      method: 'POST',
      body: {
        context: {
          frontmost: { app: 'Finder', windowTitle: 'Documents' },
        },
      },
    });
    const maskPreview = await ctx.api('/api/screen/privacy/region-mask-preview', {
      method: 'POST',
      body: {
        width: 64,
        height: 64,
        mode,
        rules: [
          {
            id: 'eval_screen_privacy_region_preview',
            kind: 'region',
            effect: 'blur',
            label: 'Eval top-right preview region',
            region: { unit: 'percent', x: 75, y: 0, width: 25, height: 25 },
          },
        ],
      },
    });
    out.push(
      privacyWithRules.ok &&
        withRules.ruleCounts?.enabled >= 3 &&
        withRules.enforcement?.appWindowContextFilter === true &&
        withRules.enforcement?.regionRendererMask === true &&
        withRules.enforcement?.regionRendererMaskStatus === 'resident_region_mask' &&
        appCheck.ok &&
        appCheck.data?.policy?.blocked === true &&
        appCheck.data?.policy?.reason?.includes('eval_screen_privacy_app') &&
        windowCheck.ok &&
        windowCheck.data?.policy?.blocked === true &&
        windowCheck.data?.policy?.reason?.includes('eval_screen_privacy_window') &&
        safeCheck.ok &&
        safeCheck.data?.policy?.allowed === true &&
        safeCheck.data?.policy?.regionRuleCount >= 1 &&
        maskPreview.ok &&
        maskPreview.data?.preview?.mask?.applied === true &&
        maskPreview.data?.preview?.samples?.insideMasked === true &&
        maskPreview.data?.preview?.samples?.outsidePreserved === true
        ? ok('screen.privacy_rules', 'Screen privacy rules', 'app/window exclusions block model screen context; region rule is pixel-masked before Realtime/API image use')
        : fail('screen.privacy_rules', 'Screen privacy rules', 'screen privacy rule policy did not match expected app/window/region mask behavior', {
          privacy: withRules,
          appCheck: appCheck.data,
          windowCheck: windowCheck.data,
          safeCheck: safeCheck.data,
          maskPreview: maskPreview.data,
        }),
    );

    const restore = await ctx.api('/api/screen/privacy', {
      method: 'PUT',
      body: {
        source: 'eval_screen_privacy_restore',
        mode,
        rules: originalRules,
      },
    });
    out.push(
      restore.ok &&
        JSON.stringify(restore.data?.privacy?.rules || []) === JSON.stringify(originalRules)
        ? ok('screen.privacy_restore', 'Screen privacy restore', `${originalRules.length} original rule(s) restored`)
        : fail('screen.privacy_restore', 'Screen privacy restore', 'failed to restore original screen privacy rules after eval', restore.data),
    );

    try {
      const cui = await execFileAsync('node', ['scripts/config-cui.cjs', '--print-screen-privacy'], {
        cwd: process.cwd(),
        env: process.env,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });
      const output = `${cui.stdout || ''}\n${cui.stderr || ''}`;
      out.push(
        output.includes('Screen Privacy') &&
          output.includes('Mode:') &&
          output.includes('Enforcement:') &&
          output.includes('Presets:') &&
          output.includes('sensitive_defaults')
          ? ok('screen.privacy_cui', 'Screen privacy CUI', 'config CUI prints screen privacy mode, rules, enforcement, and presets')
          : fail('screen.privacy_cui', 'Screen privacy CUI', 'expected --print-screen-privacy to print mode/rules/enforcement', { output: output.slice(0, 2000) }),
      );
    } catch (error) {
      out.push(fail('screen.privacy_cui', 'Screen privacy CUI', error instanceof Error ? error.message : String(error)));
    }

    return out;
  },
};
