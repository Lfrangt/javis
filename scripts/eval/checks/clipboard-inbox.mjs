import { execFileSync } from 'node:child_process';

import { ok, skip, fail } from '../_client.mjs';

function readClipboard() {
  return execFileSync('pbpaste', { encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

function writeClipboard(text) {
  execFileSync('pbcopy', { input: text, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

function totalCount(payload) {
  return Number(payload?.inbox?.counts?.total || payload?.counts?.total || 0);
}

export default {
  lane: 'clipboard-inbox',
  async run(ctx) {
    const out = [];
    if (process.platform !== 'darwin') {
      out.push(skip('clipboard_inbox.macos_only', 'Clipboard Inbox capture', 'macOS pbpaste/pbcopy required'));
      return out;
    }

    let original = '';
    let itemId = '';
    const fixture = `JAVIS eval clipboard inbox capture ${Date.now()}`;

    try {
      original = readClipboard();
    } catch (error) {
      out.push(skip('clipboard_inbox.clipboard_unavailable', 'Clipboard unavailable', error instanceof Error ? error.message : String(error)));
      return out;
    }

    try {
      const before = await ctx.api('/api/inbox');
      const beforeTotal = totalCount(before.data);
      writeClipboard(fixture);

      const preview = await ctx.api('/api/inbox/capture-clipboard', {
        method: 'POST',
        body: { source: 'eval_clipboard_preview' },
      });
      const afterPreview = await ctx.api('/api/inbox');
      const afterPreviewTotal = totalCount(afterPreview.data);
      const previewBody = preview.data || {};
      out.push(
        preview.ok &&
          previewBody.ok === true &&
          previewBody.status === 'preview' &&
          previewBody.previewOnly === true &&
          previewBody.executeRequested === false &&
          previewBody.executed === false &&
          previewBody.item === null &&
          previewBody.clipboard?.hasText === true &&
          String(previewBody.clipboard?.preview || '').includes('JAVIS eval clipboard inbox capture') &&
          previewBody.safety?.readsClipboardText === true &&
          previewBody.safety?.storesClipboardText === false &&
          previewBody.safety?.writesInbox === false &&
          previewBody.safety?.callsOpenAI === false &&
          previewBody.safety?.startsMicrophone === false &&
          previewBody.safety?.usesRealtime === false &&
          previewBody.safety?.startsWorkers === false &&
          afterPreviewTotal === beforeTotal
          ? ok('clipboard_inbox.preview', 'Clipboard capture preview', 'preview reads a short clipboard summary without writing Inbox or touching paid/voice paths')
          : fail('clipboard_inbox.preview', 'Clipboard capture preview', 'expected /api/inbox/capture-clipboard to preview by default and leave Inbox counts unchanged', {
              preview: previewBody,
              beforeTotal,
              afterPreviewTotal,
            }),
      );

      const executed = await ctx.api('/api/inbox/capture-clipboard', {
        method: 'POST',
        body: { execute: true, source: 'eval_clipboard_execute' },
      });
      const executedBody = executed.data || {};
      itemId = executedBody.item?.id || '';
      out.push(
        executed.ok &&
          executedBody.ok === true &&
          executedBody.status === 'saved' &&
          executedBody.previewOnly === false &&
          executedBody.executeRequested === true &&
          executedBody.executed === true &&
          itemId &&
          executedBody.item?.body === fixture &&
          executedBody.item?.source === 'eval_clipboard_execute' &&
          executedBody.window?.lastInboxCapture?.id === itemId &&
          executedBody.safety?.readsClipboardText === true &&
          executedBody.safety?.storesClipboardText === true &&
          executedBody.safety?.writesInbox === true &&
          executedBody.safety?.callsOpenAI === false &&
          executedBody.safety?.startsMicrophone === false &&
          executedBody.safety?.usesRealtime === false &&
          executedBody.safety?.startsWorkers === false
          ? ok('clipboard_inbox.execute', 'Clipboard capture execute', `saved throwaway item ${itemId.slice(0, 8)} with no OpenAI/mic/Realtime side effects`)
          : fail('clipboard_inbox.execute', 'Clipboard capture execute', 'expected execute:true to save exactly one local Inbox item with explicit safety flags', executedBody),
      );
    } finally {
      if (itemId) {
        const cleanup = await ctx.api(`/api/inbox/${encodeURIComponent(itemId)}`, {
          method: 'DELETE',
          body: { source: 'eval_clipboard_cleanup' },
        });
        out.push(
          cleanup.ok && (cleanup.data?.removed?.id === itemId || cleanup.data?.ok)
            ? ok('clipboard_inbox.cleanup', 'Clipboard capture cleanup', `removed throwaway item ${itemId.slice(0, 8)}`)
            : fail('clipboard_inbox.cleanup', 'Clipboard capture cleanup', `DELETE /api/inbox/${itemId.slice(0, 8)} ${cleanup.status} ${cleanup.error || ''}`, cleanup.data),
        );
      }
      try {
        writeClipboard(original);
      } catch (error) {
        out.push(fail('clipboard_inbox.restore_clipboard', 'Restore clipboard', error instanceof Error ? error.message : String(error)));
      }
    }

    return out;
  },
};
