export type RealtimeProgressWorkerGroup = {
  id?: string
  parallelGroup: string
  owner: string
  lane: string
  total: number
  statusCounts: Record<string, number>
  active: number
  done: number
  failed: number
  latestUpdatedAt: number
  latestResultLink?: string
  nextAction: string
}

export type RealtimeWorkProgress = {
  output: string
  version?: {
    sequence: number
    updatedAt: number
    source: string
  }
  counts: {
    activeJobs: number
    activeWorkflows: number
    blockedWorkflows: number
    activeRoutes?: number
  }
  routingLedger?: unknown[]
  activeRoutes?: unknown[]
  workerGroups?: RealtimeProgressWorkerGroup[]
  workerSummary?: string
  latestDone?: {
    job?: { updatedAt?: number } | null
    workflow?: { updatedAt?: number } | null
    route?: { updatedAt?: number } | null
  }
}

export type RealtimeProgressInjectionEvidence = {
  progressSequence: number
  progressUpdatedAt: number
  progressSource: string
  contextLength: number
  contextPreview: string
  workerSummary: string
  workerGroups: number
  activeWorkerGroups: number
  activeWorkers: number
  doneWorkers: number
  failedWorkers: number
  activeJobs: number
  activeWorkflows: number
  blockedWorkflows: number
  activeRoutes: number
  groups: Array<{
    owner: string
    lane: string
    parallelGroup: string
    active: number
    done: number
    failed: number
  }>
}

export function compactRealtimeText(value: string, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`
}

export function realtimeWorkerProgressContext(progress: RealtimeWorkProgress, since: number) {
  const groups = (progress.workerGroups || [])
    .filter((group) => {
      const fresh = Boolean(group.latestUpdatedAt && group.latestUpdatedAt >= since - 5000)
      return group.active > 0 || fresh
    })
    .slice(0, 5)
  if (!groups.length) return ''

  const lines = groups.map((group, index) => {
    const counts = [
      group.active ? `${group.active} active` : '',
      group.done ? `${group.done} done` : '',
      group.failed ? `${group.failed} failed` : '',
      group.statusCounts.cancelled ? `${group.statusCounts.cancelled} cancelled` : '',
    ].filter(Boolean).join(', ') || `${group.total} tracked`
    const next = group.nextAction ? ` next=${compactRealtimeText(group.nextAction, 140)}` : ''
    return `${index + 1}. ${compactRealtimeText(group.owner, 50)}/${compactRealtimeText(group.lane, 40)} group=${compactRealtimeText(group.parallelGroup, 70)} ${counts}.${next}`
  })

  return [
    `Worker summary: ${progress.workerSummary || `${groups.length} worker group(s)`}.`,
    ...lines,
  ].join('\n')
}

export function realtimeWorkProgressContext(progress: RealtimeWorkProgress, since: number) {
  const latestDoneJobIsFresh = Boolean(progress.latestDone?.job?.updatedAt && progress.latestDone.job.updatedAt >= since - 5000)
  const latestDoneWorkflowIsFresh = Boolean(progress.latestDone?.workflow?.updatedAt && progress.latestDone.workflow.updatedAt >= since - 5000)
  const latestDoneRouteIsFresh = Boolean(progress.latestDone?.route?.updatedAt && progress.latestDone.route.updatedAt >= since - 5000)
  const activeRouteCount = progress.counts.activeRoutes || progress.activeRoutes?.length || progress.routingLedger?.length || 0
  const workerContext = realtimeWorkerProgressContext(progress, since)
  const hasActiveWork =
    progress.counts.activeJobs > 0 ||
    progress.counts.activeWorkflows > 0 ||
    progress.counts.blockedWorkflows > 0 ||
    activeRouteCount > 0 ||
    Boolean(workerContext) ||
    latestDoneJobIsFresh ||
    latestDoneWorkflowIsFresh ||
    latestDoneRouteIsFresh
  const outputText = progress.output.trim()
  if (!hasActiveWork || (!workerContext && !outputText)) return ''
  const progressText = workerContext || outputText
  return [
    'Silent JAVIS background work progress update. Do not answer this message by itself.',
    'Use this only if the user asks about background work, queued tasks, Codex/Claude runs, approvals, or next actions.',
    'Prefer the grouped worker summary over raw job logs. Keep any spoken progress answer short.',
    progressText,
  ].join('\n')
}

export function buildRealtimeTextContextEvent(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: trimmed,
        },
      ],
    },
  }
}

export function realtimeProgressInjectionEvidence(
  progress: RealtimeWorkProgress,
  contextText: string,
): RealtimeProgressInjectionEvidence {
  const groups = (progress.workerGroups || []).slice(0, 5)
  return {
    progressSequence: Math.max(0, Number(progress.version?.sequence || 0)),
    progressUpdatedAt: Math.max(0, Number(progress.version?.updatedAt || 0)),
    progressSource: compactRealtimeText(progress.version?.source || '', 80),
    contextLength: contextText.length,
    contextPreview: compactRealtimeText(contextText, 240),
    workerSummary: progress.workerSummary || '',
    workerGroups: groups.length,
    activeWorkerGroups: groups.filter((group) => group.active > 0).length,
    activeWorkers: groups.reduce((sum, group) => sum + Math.max(0, Number(group.active || 0)), 0),
    doneWorkers: groups.reduce((sum, group) => sum + Math.max(0, Number(group.done || 0)), 0),
    failedWorkers: groups.reduce((sum, group) => sum + Math.max(0, Number(group.failed || 0)), 0),
    activeJobs: Math.max(0, Number(progress.counts.activeJobs || 0)),
    activeWorkflows: Math.max(0, Number(progress.counts.activeWorkflows || 0)),
    blockedWorkflows: Math.max(0, Number(progress.counts.blockedWorkflows || 0)),
    activeRoutes: Math.max(0, Number(progress.counts.activeRoutes || progress.activeRoutes?.length || progress.routingLedger?.length || 0)),
    groups: groups.map((group) => ({
      owner: compactRealtimeText(group.owner, 50),
      lane: compactRealtimeText(group.lane, 40),
      parallelGroup: compactRealtimeText(group.parallelGroup, 70),
      active: Math.max(0, Number(group.active || 0)),
      done: Math.max(0, Number(group.done || 0)),
      failed: Math.max(0, Number(group.failed || 0)),
    })),
  }
}
