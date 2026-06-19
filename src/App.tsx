import {
  Activity,
  Bell,
  Brain,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  Clipboard,
  ClipboardList,
  Eye,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Mic,
  Monitor,
  MousePointerClick,
  Play,
  Power,
  Send,
  ShieldCheck,
  Settings,
  Square,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import { buildRealtimeTextContextEvent, realtimeProgressInjectionEvidence, realtimeWorkProgressContext } from './realtimeProgress'

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
type WorkflowStatus = JobStatus | 'blocked'
type JobMode = 'background' | 'codex' | 'claude' | 'cli'
type BrowserWorkflowIntent = 'summarize' | 'extract_actions' | 'draft' | 'ask' | 'act' | 'search' | 'compare' | 'review_result' | 'research'
type BrowserWorkflowMode = 'quick' | JobMode
type VoiceStatus = 'idle' | 'connecting' | 'live' | 'error'
type MicMode = 'open' | 'push'

type RealtimeLatencyTimeline = {
  startedAt: number
  micReadyAt: number
  offerCreatedAt: number
  negotiationStartedAt: number
  answerReceivedAt: number
  remoteDescriptionAt: number
  dataChannelOpenAt: number
  firstProgressInjectionAt: number
  endedAt: number
  errorAt: number
}

type RealtimeLatencyReceipt = RealtimeLatencyTimeline & {
  source: string
  sessionId: string
  micMode: MicMode
  screenLive: boolean
  ok: boolean
  status: string
  stage: string
  quality: string
  micReadyMs: number
  offerReadyMs: number
  negotiationMs: number
  answerToRemoteDescriptionMs: number
  remoteDescriptionToLiveMs: number
  startToLiveMs: number
  liveToFirstProgressMs: number
  totalSessionMs: number
  error: string
  createdAt: number
}

type RealtimeRendererDogfoodCommand = {
  action?: string
  runId?: string
  screenLive?: boolean
  prompts?: string[]
  promptDelayMs?: number
  betweenPromptsMs?: number
  stopAfterMs?: number
  source?: string
}

const emptyRealtimeLatencyTimeline = (): RealtimeLatencyTimeline => ({
  startedAt: 0,
  micReadyAt: 0,
  offerCreatedAt: 0,
  negotiationStartedAt: 0,
  answerReceivedAt: 0,
  remoteDescriptionAt: 0,
  dataChannelOpenAt: 0,
  firstProgressInjectionAt: 0,
  endedAt: 0,
  errorAt: 0,
})

type SetupAction =
  | 'prepare_env_file'
  | 'open_screen_settings'
  | 'open_accessibility_settings'
  | 'open_microphone_settings'
  | 'open_runtime_dir'
  | 'open_action_policy'
  | 'install_resident_agent'
  | 'uninstall_resident_agent'
type WindowMode = 'pet' | 'panel'

type WindowState = {
  mode: WindowMode
  hotkey: string
  hotkeyRegistered: boolean
  summonHotkey: string
  summonHotkeyRegistered: boolean
  captureHotkey: string
  captureHotkeyRegistered: boolean
  lastInboxCapture: null | {
    id: string
    title: string
    source: string
    createdAt: number
  }
  position?: {
    x: number
    y: number
    width: number
    height: number
  }
  parkCorner?: string
  parkDisplay?: string
  parkMargin?: number
  width: number
  height: number
}

type MenuBarState = {
  available: boolean
  updatedAt: number | null
}

type NotificationsState = {
  enabled: boolean
  supported: boolean
  sent: number
  skipped: number
  last: null | {
    title: string
    body: string
    delivered: boolean
    reason?: string
    createdAt: number
  }
}

type ConversationState = {
  status: VoiceStatus
  active: boolean
  stale: boolean
  sessionId: string
  micMode: MicMode
  screenLive: boolean
  source: string
  error: string
  startedAt: number
  liveAt: number
  endedAt: number
  updatedAt: number
  lastHeartbeatAt: number
  transitionCount: number
  ageMs: number | null
  activeForMs: number | null
  staleAfterMs: number
  realtimeProgressInjectionCount?: number
  realtimeSessionNegotiationCount?: number
  realtimeLatencyReceiptCount?: number
  lastRealtimeSessionNegotiation?: null | {
    source: string
    sessionId: string
    micMode: MicMode
    model: string
    voice: string
    offerBytes: number
    answerBytes: number
    statusCode: number
    ok: boolean
    durationMs: number
    error: string
    createdAt: number
  }
  lastRealtimeLatencyReceipt?: null | RealtimeLatencyReceipt
  lastRealtimeProgressInjection?: null | {
    source: string
    sessionId: string
    status: string
    transport?: string
    dataChannelReadyState?: string
    eventType?: string
    eventRole?: string
    contentType?: string
    forcedResponse?: boolean
    responseActive?: boolean
    progressSequence?: number
    progressUpdatedAt?: number
    progressSource?: string
    voiceStatus?: string
    micMode?: MicMode
    screenLive?: boolean
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
    createdAt: number
  }
}

type PresenceMode =
  | 'standby'
  | 'watching'
  | 'waking'
  | 'connecting'
  | 'listening'
  | 'voice_error'
  | 'working'
  | 'needs_attention'
  | 'setup_blocked'

type PresenceState = {
  ok: boolean
  generatedAt: string
  mode: PresenceMode
  label: string
  summary: string
  intervention: {
    passiveByDefault: boolean
    requiresUserIntent: boolean
    canActWhenInvited: boolean
    trustedLocalMode: boolean
    maxAutoRiskLevel: number
    requireApprovalAtRiskLevel: number
    next: string
  }
  observing?: {
    latest?: {
      available: boolean
      app: string
      windowTitle: string
      browser?: {
        available: boolean
        app: string
        title: string
        url: string
        host: string
      }
    }
  }
}

type RealtimePreflightContext = {
  enabled: boolean
  generatedAt: string
  prompt: string
}

type ScreenPrivacy = {
  version: number
  mode: 'private' | 'clear'
  label: string
  maxWidth: number
  blurPx: number
  jpegQuality: number
  realtimeAllowed: boolean
  rules?: Array<{
    id: string
    enabled: boolean
    kind: string
    effect: string
    match: string
    value: string
    label: string
  }>
  ruleCounts?: Record<string, number>
  rulesSummary?: string
  enforcement?: Record<string, unknown>
  updatedAt: number
}

type Job = {
  id: string
  title: string
  mode: JobMode
  status: JobStatus
  createdAt: number
  updatedAt: number
  log: string
  result: string
  startedAt?: number
  completedAt?: number
  pid?: number | null
  cancelRequested?: boolean
}

type WorkflowRecord = {
  id: string
  kind: string
  source: string
  status: WorkflowStatus
  title: string
  intent: string
  mode: string
  request: string
  result: string
  target: {
    app: string
    title: string
    url: string
    fallback: string
    textLength: number
    returnedLength: number
  }
  jobId: string
  createdAt: number
  updatedAt: number
  completedAt: number
}

type RoutingLedgerEntry = {
  id: string
  taskTitle: string
  lane: 'quick' | 'background' | 'codex' | 'claude' | 'local'
  owner: string
  scope: string
  parallelGroup: string
  approvalRequirement: string
  status: string
  blocker: string
  nextAction: string
  resultLink: string
  resultSummary: string
  jobId: string
  workflowId: string
  updatedAt: number
}

type RoutingRecord = RoutingLedgerEntry & {
  label?: string
  source?: string
  execute?: boolean
  confidence?: number
  reason?: string
  localCommand?: string
  memoryMatches?: number
  createdAt?: number
  completedAt?: number
}

type Approval = {
  id: string
  action: string
  riskLevel: number
  reason: string
  summary: string
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
  createdAt: number
  updatedAt: number
  result: string
}

type InboxItem = {
  id: string
  title: string
  body: string
  status: 'open' | 'done' | 'cancelled'
  priority: number
  source: string
  tags: string[]
  route?: null | {
    lane: string
    label: string
    queued: boolean
    jobId: string
    output: string
    routedAt: number
  }
  createdAt: number
  updatedAt: number
  completedAt: number
}

type InboxTriage = {
  ok: boolean
  output: string
  counts: {
    total: number
    open: number
    done: number
    cancelled: number
  }
  items: Array<{
    id: string
    title: string
    priority: number
    age: string
    decision: {
      lane: string
      mode: string
      label: string
      reason: string
      confidence: number
    }
    summary: string
  }>
  next: null | {
    id: string
    title: string
    priority: number
    age: string
    summary: string
  }
}

type WorkSessionEvent = {
  id: string
  type: string
  text: string
  source: string
  ref?: null | {
    kind: string
    id: string
    status: string
  }
  createdAt: number
}

type WorkSession = {
  id: string
  title: string
  goal: string
  status: 'active' | 'done' | 'cancelled'
  source: string
  tags: string[]
  events: WorkSessionEvent[]
  summary: string
  createdAt: number
  updatedAt: number
  completedAt: number
}

type SessionCheckIn = {
  ok: boolean
  output: string
  active: WorkSession | null
  counts: {
    total: number
    active: number
    done: number
    cancelled: number
  }
  recentEvents: WorkSessionEvent[]
  nextActions: BriefingNextAction[]
}

type Status = {
  api: {
    baseUrl: string
    hasOpenAiKey: boolean
    localExecutionEnabled: boolean
    trustedLocalMode?: boolean
  }
  actionPolicy?: {
    dryRun: boolean
    maxAutoRiskLevel: number
    requireApprovalAtRiskLevel: number
  }
  window?: WindowState
  menuBar?: MenuBarState
  notifications?: NotificationsState
  approvals?: Approval[]
  models: {
    realtime: string
    realtimeVoice: string
    fast: string
    background: string
    vision: string
  }
  screen: null | {
    width: number
    height: number
    updatedAt: number
    privacy?: ScreenPrivacy
    imageDataUrl?: string
  }
  screenPrivacy?: ScreenPrivacy
  presence?: PresenceState
  conversation?: ConversationState
  progressVersion?: ProgressVersion
  speech?: {
    available: boolean
    enabled: boolean
    speaking: boolean
    pid: number | null
  }
  ambient?: {
    enabled: boolean
    captureScreen: boolean
    intervalMs: number
    count: number
    recent: unknown[]
  }
  wake?: {
    words: string[]
    softWakeOnly: boolean
    triggerTtlMs: number
    pending: boolean
    ageMs: number | null
    lastTriggerAt: number
    lastSource: string
    lastPhrase: string
    triggerCount: number
    engine: {
      configured: boolean
      command: string
      running: boolean
      pid: number | null
      startedAt: number
      lastLine: string
      lastError: string
    }
  }
  readiness?: {
    overall: 'ready' | 'degraded' | 'blocked'
    label: string
    summary: string
    counts: {
      ready: number
      warning: number
      blocked: number
      total: number
    }
    primaryIssue: null | {
      id: string
      label: string
      status: 'ready' | 'warning' | 'blocked'
      summary: string
      next: string
    }
  }
  inbox?: {
    counts: {
      total: number
      open: number
      done: number
      cancelled: number
    }
    open: InboxItem[]
  }
  sessions?: {
    counts: {
      total: number
      active: number
      done: number
      cancelled: number
    }
    active: WorkSession | null
    recent: WorkSession[]
  }
  routing?: {
    counts: Record<string, number>
    active: RoutingRecord[]
    ledger: RoutingLedgerEntry[]
    recent: RoutingRecord[]
  }
  queue: Job[]
  workflows?: WorkflowRecord[]
}

type ConfigItem = {
  id: string
  label: string
  status: 'ready' | 'warning' | 'blocked'
  summary: string
  next: string
}

type ConfigCheck = {
  overall: 'ready' | 'degraded' | 'blocked'
  summary: string
  generatedAt: string
  counts: {
    ready: number
    warning: number
    blocked: number
    total: number
  }
  primaryIssue: ConfigItem | null
  items: ConfigItem[]
}

type SetupGuide = {
  ok: boolean
  overall: 'ready' | 'degraded' | 'blocked'
  output: string
  counts: ConfigCheck['counts']
  nextStep: null | {
    id: string
    label: string
    status: 'ready' | 'warning' | 'blocked'
    summary: string
    next: string
    action: null | {
      action: SetupAction
      label: string
      reason: string
    }
  }
  generatedAt: string
}

type DoctorCheck = {
  id: string
  label: string
  status: 'ready' | 'warning' | 'blocked'
  summary: string
  next: string
}

type DoctorReport = {
  ok: boolean
  overall: 'ready' | 'degraded' | 'blocked'
  label: string
  summary: string
  counts: {
    ready: number
    warning: number
    blocked: number
    total: number
  }
  checks: DoctorCheck[]
  generatedAt: string
}

type BriefingNextAction = {
  id: string
  priority: number
  label: string
  summary: string
  source: string
  workflowId?: string
  inboxId?: string
  sessionId?: string
}

type WorkBriefing = {
  ok: boolean
  generatedAt: string
  summary: string
  counts: {
    pendingApprovals: number
    memories: number
    inbox?: {
      total: number
      open: number
      done: number
      cancelled: number
    }
    sessions?: {
      total: number
      active: number
      done: number
      cancelled: number
    }
    activeJobs: number
    blockedWorkflows: number
    workflows: Record<string, number>
    jobs: Record<string, number>
    routing?: Record<string, number>
    activeRoutes?: number
  }
  routingLedger?: RoutingLedgerEntry[]
  nextActions: BriefingNextAction[]
}

type WorkProgress = {
  ok: boolean
  output: string
  version?: ProgressVersion
  counts: {
    jobs: Record<string, number>
    workflows: Record<string, number>
    activeJobs: number
    activeWorkflows: number
    blockedWorkflows: number
    workerGroups?: number
    activeRoutes?: number
    routing?: Record<string, number>
  }
  routingLedger?: RoutingLedgerEntry[]
  activeRoutes?: RoutingRecord[]
  recentRoutes?: RoutingRecord[]
  activeJobs: Job[]
  recentJobs: Job[]
  workerGroups?: Array<{
    id: string
    parallelGroup: string
    owner: string
    lane: string
    total: number
    statusCounts: Record<string, number>
    active: number
    done: number
    failed: number
    latestUpdatedAt: number
    latestResultLink: string
    nextAction: string
    jobs: Array<{
      id: string
      title: string
      mode: string
      lane: string
      owner: string
      parallelGroup: string
      status: JobStatus
      source: string
      updatedAt: number
      resultLink: string
      resultSummary: string
      recoveryHint: string
      failureKind: string
    }>
  }>
  workerSummary?: string
  activeWorkflows: WorkflowRecord[]
  blockedWorkflows: WorkflowRecord[]
  recentWorkflows: WorkflowRecord[]
  latestDone?: {
    job: Job | null
    workflow: WorkflowRecord | null
    route?: RoutingRecord | null
  }
  nextActions: BriefingNextAction[]
}

type WorkNextResult = {
  ok: boolean
  executed: boolean
  action: BriefingNextAction | null
  output: string
  result?: unknown
  briefing?: WorkBriefing
}

type BrowserWorkflowResult = {
  ok: boolean
  mode: BrowserWorkflowMode
  intent: BrowserWorkflowIntent
  queued?: boolean
  output: string
  job?: Job
  workflow?: WorkflowRecord
  page?: {
    title: string
    url: string
    app: string
    returnedLength: number
    textLength: number
    fallback: string
    error: string
    linkCount?: number
    links?: Array<{ index: number; text: string; href: string; host: string; sameHost: boolean }>
    searchResults?: Array<{ index: number; text: string; href: string; host: string; sameHost: boolean }>
  }
}

type TaskRouteResult = {
  ok: boolean
  executed: boolean
  queued: boolean
  decision: {
    lane: 'quick' | 'background' | 'codex' | 'claude'
    label: string
    reason: string
    confidence: number
  }
  output: string
  job?: Job
}

type ProcessNextInboxResult = {
  ok: boolean
  output: string
  selected?: InboxTriage['items'][number]
  item?: InboxItem
  route?: TaskRouteResult
  inbox?: {
    counts: InboxTriage['counts']
    open: InboxItem[]
  }
}

type MacContext = {
  frontmost: {
    available: boolean
    app: string
    windowTitle: string
    error: string
  }
  browser: {
    available: boolean
    supported: boolean
    app: string
    title: string
    url: string
    source: string
    error: string
  }
  permissions: {
    accessibilityTrusted: boolean | null
  }
  clipboard: {
    hasText: boolean
    length: number
    preview: string
    truncated: boolean
  }
  activeJobs: string[]
  pendingApprovals: Array<{
    id: string
    action: string
    riskLevel: number
    summary: string
  }>
}

type AccessibilityTree = {
  available: boolean
  app: string
  windowTitle: string
  nodeCount: number
  truncated: boolean
  outline: string
  error: string
}

type AccessibilityPlan = {
  ok: boolean
  app: string
  windowTitle: string
  instruction: string
  candidates: Array<{
    id: string
    role: string
    label: string
    score: number
  }>
  recommended: {
    type: string
    nodeId?: string
    role?: string
    label?: string
    summary: string
    nextStep: string
    executableNow: boolean
  }
  tree: {
    nodeCount: number
    truncated: boolean
    error: string
  }
}

type AuditEvent = {
  ts: string
  type: string
  data?: Record<string, unknown>
}

type ProgressVersion = {
  sequence: number
  updatedAt: number
  source: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  createdAt: number
}

const API_BASE = import.meta.env.VITE_JAVIS_API_BASE || 'http://127.0.0.1:3417'
const startupTime = Date.now()
const realtimeWorkProgressSyncMs = Number(import.meta.env.VITE_JAVIS_REALTIME_WORK_PROGRESS_SYNC_MS || 30000)
const REALTIME_WORK_PROGRESS_SYNC_MS = Number.isFinite(realtimeWorkProgressSyncMs)
  ? Math.max(15000, Math.min(120000, realtimeWorkProgressSyncMs))
  : 30000
const PET_STATUS_POLL_MS = 5000
const PANEL_DETAIL_POLL_MS = 30000
const SCREEN_CONTEXT_LIVE_POLL_MS = 15000
const SCREEN_CONTEXT_IDLE_POLL_MS = 120000
const DEFAULT_SCREEN_PRIVACY: ScreenPrivacy = {
  version: 1,
  mode: 'private',
  label: 'Private',
  maxWidth: 640,
  blurPx: 5,
  jpegQuality: 0.46,
  realtimeAllowed: true,
  updatedAt: startupTime,
}

type PetMood = 'standby' | 'ready' | 'watching' | 'listening' | 'thinking' | 'attention' | 'needs-key'

function petMoodLabel(mood: PetMood, presence?: PresenceState, talking = false) {
  if (mood === 'needs-key') return 'Needs key'
  if (talking) return 'Hearing you'
  if (presence?.label) return presence.label
  if (mood === 'attention') return 'Needs attention'
  if (mood === 'listening') return 'Listening'
  if (mood === 'thinking') return 'Working'
  if (mood === 'watching') return 'Watching'
  if (mood === 'standby') return 'Standby'
  return 'Ready'
}

function initialApiToken() {
  const params = new URLSearchParams(window.location.search)
  const queryToken = params.get('javisApiToken') || ''
  if (queryToken) {
    window.sessionStorage.setItem('javisApiToken', queryToken)
    params.delete('javisApiToken')
    const nextSearch = params.toString()
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
    window.history.replaceState({}, document.title, nextUrl)
    return queryToken
  }
  return window.sessionStorage.getItem('javisApiToken') || ''
}

const API_TOKEN = initialApiToken()

function apiHeaders(init?: RequestInit, contentType = 'application/json') {
  const headers = new Headers(init?.headers)
  if (contentType && !headers.has('Content-Type')) headers.set('Content-Type', contentType)
  if (API_TOKEN) headers.set('X-JAVIS-Token', API_TOKEN)
  return headers
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: apiHeaders(init),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.details || data?.error || response.statusText
    throw new Error(message)
  }
  return data as T
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)))
}

function utf8Bytes(value = '') {
  return new TextEncoder().encode(value).length
}

async function fetchDoctorReport() {
  const result = await apiJson<{ doctor: DoctorReport }>('/api/doctor/report')
  return result.doctor
}

async function fetchWorkBriefing() {
  const result = await apiJson<{ briefing: WorkBriefing }>('/api/briefing')
  return result.briefing
}

function timeLabel(value?: number) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function jobTone(status: JobStatus) {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'running') return 'running'
  return 'queued'
}

function workflowTone(status: WorkflowStatus) {
  if (status === 'done') return 'done'
  if (status === 'failed' || status === 'blocked') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'running') return 'running'
  return 'queued'
}

function compactJobText(job: Job) {
  const text = job.result || job.log || ''
  return text.split('\n').filter(Boolean).slice(-2).join(' · ')
}

function compactWorkflowText(workflow: WorkflowRecord) {
  const text = workflow.result || workflow.request || workflow.target?.url || ''
  return text.split('\n').filter(Boolean).slice(0, 2).join(' · ')
}

function normalizedScreenPrivacy(value?: ScreenPrivacy) {
  return value || DEFAULT_SCREEN_PRIVACY
}

function App() {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'system',
      text: 'JAVIS is resting on your desktop.',
      createdAt: startupTime,
    },
  ])
  const [quickInput, setQuickInput] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [taskMode, setTaskMode] = useState<JobMode>('background')
  const [browserIntent, setBrowserIntent] = useState<BrowserWorkflowIntent>('summarize')
  const [browserMode, setBrowserMode] = useState<BrowserWorkflowMode>('quick')
  const [browserInstruction, setBrowserInstruction] = useState('')
  const [browserBusy, setBrowserBusy] = useState(false)
  const [setupBusy, setSetupBusy] = useState<SetupAction | ''>('')
  const [busy, setBusy] = useState(false)
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle')
  const [micMode, setMicMode] = useState<MicMode>('open')
  const [isPushingToTalk, setIsPushingToTalk] = useState(false)
  const [screenLive, setScreenLive] = useState(false)
  const [screenPreview, setScreenPreview] = useState('')
  const [realtimeScreenContext, setRealtimeScreenContext] = useState(true)
  const [screenSyncCount, setScreenSyncCount] = useState(0)
  const [lastScreenSyncAt, setLastScreenSyncAt] = useState<number | null>(null)
  const [lastError, setLastError] = useState('')
  const [runtimeEvents, setRuntimeEvents] = useState<AuditEvent[]>([])
  const [macContext, setMacContext] = useState<MacContext | null>(null)
  const [configCheck, setConfigCheck] = useState<ConfigCheck | null>(null)
  const [doctorReport, setDoctorReport] = useState<DoctorReport | null>(null)
  const [workBriefing, setWorkBriefing] = useState<WorkBriefing | null>(null)
  const [doctorBusy, setDoctorBusy] = useState(false)
  const [briefingBusy, setBriefingBusy] = useState(false)
  const [progressBusy, setProgressBusy] = useState(false)
  const [workNextBusy, setWorkNextBusy] = useState(false)
  const [setupNextBusy, setSetupNextBusy] = useState(false)
  const [copyingWorkflowId, setCopyingWorkflowId] = useState('')
  const [routingInboxId, setRoutingInboxId] = useState('')
  const [triageInboxBusy, setTriageInboxBusy] = useState(false)
  const [processingNextInbox, setProcessingNextInbox] = useState(false)
  const [endingSessionId, setEndingSessionId] = useState('')
  const [checkingSessionId, setCheckingSessionId] = useState('')
  const [resumingSessionId, setResumingSessionId] = useState('')
  const [accessibilityBusy, setAccessibilityBusy] = useState<'tree' | 'plan' | 'guard' | 'act' | ''>('')
  const [accessibilitySummary, setAccessibilitySummary] = useState('')
  const [accessibilityTarget, setAccessibilityTarget] = useState<{ nodeId: string; role: string; label: string } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const handledToolCallsRef = useRef<Set<string>>(new Set())
  const lastRealtimeScreenSyncRef = useRef(0)
  const lastWakeHandledAtRef = useRef(0)
  const voiceSessionIdRef = useRef('')
  const screenPreviewRef = useRef('')
  const screenFrameRef = useRef<{ width: number; height: number } | null>(null)
  const realtimeScreenContextRef = useRef(realtimeScreenContext)
  const initialScreenContextTimeoutRef = useRef<number | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startScreenX: number
    startScreenY: number
    startWindowX: number
    startWindowY: number
    moved: boolean
  } | null>(null)
  const dragPendingRef = useRef<{ x: number; y: number } | null>(null)
  const dragFrameRef = useRef<number | null>(null)
  const dragSuppressClickRef = useRef(false)
  const previousPushStateRef = useRef(false)
  const responseActiveRef = useRef(false)
  const lastRealtimeWorkProgressSignatureRef = useRef('')
  const lastRealtimeWorkProgressSyncAtRef = useRef(0)
  const lastRealtimeWorkProgressSequenceRef = useRef(0)
  const realtimeVoiceLiveStartedAtRef = useRef(0)
  const realtimeLatencyRef = useRef<RealtimeLatencyTimeline>(emptyRealtimeLatencyTimeline())
  const voiceStatusRef = useRef<VoiceStatus>('idle')
  const screenLiveRef = useRef(false)

  const jobs = status?.queue || []
  const workflows = status?.workflows || []
  const approvals = status?.approvals || []
  const inboxOpen = status?.inbox?.open || []
  const activeSession = status?.sessions?.active || null
  const screenPrivacy = normalizedScreenPrivacy(status?.screenPrivacy)
  const resumableSession = !activeSession ? (status?.sessions?.recent || []).find((session) => session.status !== 'active') || null : null
  const sessionRecentEvents = useMemo(() => (activeSession?.events || []).slice(-2).reverse(), [activeSession])
  const readiness = status?.readiness
  const activeJobCount = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length
  const doctorIssues = useMemo(
    () => (doctorReport?.checks || []).filter((check) => check.status !== 'ready').slice(0, 2),
    [doctorReport],
  )
  const configIssues = useMemo(() => {
    const doctorIssueIds = new Set(doctorIssues.map((check) => check.id))
    return (configCheck?.items || [])
      .filter((item) => item.status !== 'ready' && !doctorIssueIds.has(item.id))
      .slice(0, 3)
  }, [configCheck, doctorIssues])
  const briefingActions = useMemo(() => (workBriefing?.nextActions || []).slice(0, 2), [workBriefing])

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setMessages((current) => [
      ...current.slice(-36),
      { id: crypto.randomUUID(), role, text, createdAt: Date.now() },
    ])
  }, [])

  useEffect(() => {
    realtimeScreenContextRef.current = realtimeScreenContext
  }, [realtimeScreenContext])

  useEffect(() => {
    voiceStatusRef.current = voiceStatus
  }, [voiceStatus])

  useEffect(() => {
    screenLiveRef.current = screenLive
  }, [screenLive])

  const loadDoctorReport = useCallback(async () => {
    const doctor = await fetchDoctorReport()
    setDoctorReport(doctor)
    return doctor
  }, [])

  const loadWorkBriefing = useCallback(async () => {
    const briefing = await fetchWorkBriefing()
    setWorkBriefing(briefing)
    return briefing
  }, [])

  const loadPanelDetails = useCallback(async () => {
    const [audit, context, config, doctor, briefing] = await Promise.all([
      apiJson<{ events: AuditEvent[] }>('/api/audit/recent?limit=8'),
      apiJson<{ context: MacContext }>('/api/mac/context'),
      apiJson<{ config: ConfigCheck }>('/api/config/check'),
      fetchDoctorReport(),
      fetchWorkBriefing(),
    ])
    setRuntimeEvents(audit.events)
    setMacContext(context.context)
    setConfigCheck(config.config)
    setDoctorReport(doctor)
    setWorkBriefing(briefing)
  }, [])

  const setMicTracksEnabled = useCallback((enabled: boolean) => {
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled
    })
  }, [])

  const sendRealtimeEvent = useCallback((event: Record<string, unknown>) => {
    const dataChannel = dataChannelRef.current
    if (!dataChannel || dataChannel.readyState !== 'open') return false
    dataChannel.send(
      JSON.stringify({
        event_id: `javis_${crypto.randomUUID()}`,
        ...event,
      }),
    )
    return true
  }, [])

  const pushRealtimeTextContext = useCallback(
    (text: string) => {
      const event = buildRealtimeTextContextEvent(text)
      return event ? sendRealtimeEvent(event) : false
    },
    [sendRealtimeEvent],
  )

  const postRendererDogfoodEvent = useCallback(async (payload: Record<string, unknown>) => {
    try {
      await apiJson('/api/realtime/dogfood/renderer/event', {
        method: 'POST',
        body: JSON.stringify({
          source: 'renderer',
          ...payload,
        }),
      })
    } catch {
      // Dogfood event telemetry should not interrupt the voice path.
    }
  }, [])

  const sendRealtimeUserText = useCallback(
    (text: string) => {
      const prompt = text.trim()
      if (!prompt) return false
      const sent = sendRealtimeEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: prompt,
            },
          ],
        },
      })
      if (!sent) return false
      sendRealtimeEvent({ type: 'response.create' })
      addMessage('user', prompt)
      return true
    },
    [addMessage, sendRealtimeEvent],
  )

  const pushRealtimeScreenContext = useCallback(
    (imageDataUrl: string, width: number, height: number, force = false) => {
      if (!realtimeScreenContext) return false
      const regionRuleCount = Number(screenPrivacy.enforcement?.regionRuleCount || screenPrivacy.ruleCounts?.region || 0)
      if (regionRuleCount > 0 && screenPrivacy.enforcement?.regionRendererMask !== true) {
        return false
      }
      const now = Date.now()
      if (!force && now - lastRealtimeScreenSyncRef.current < 15000) return false

      const sent = sendRealtimeEvent({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                `Silent Mac screen context update at ${new Date(now).toLocaleTimeString()}.`,
                `Frame size: ${width}x${height}.`,
                `Screen privacy mode: ${screenPrivacy.mode}.`,
                screenPrivacy.rulesSummary ? `Screen privacy rules: ${screenPrivacy.rulesSummary}.` : '',
                'Use this as the latest visible screen context. Do not answer this update by itself.',
              ].filter(Boolean).join(' '),
            },
            {
              type: 'input_image',
              image_url: imageDataUrl,
            },
          ],
        },
      })

      if (sent) {
        lastRealtimeScreenSyncRef.current = now
        setLastScreenSyncAt(now)
        setScreenSyncCount((count) => count + 1)
      }
      return sent
    },
    [realtimeScreenContext, screenPrivacy, sendRealtimeEvent],
  )

  const refreshStatus = useCallback(async () => {
    try {
      const next = await apiJson<Status>('/api/status')
      setStatus(next)
      if (next.window) setExpanded(next.window.mode === 'panel')
      setLastError('')
      await loadPanelDetails()
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error))
    }
  }, [loadPanelDetails])

  const setWindowMode = useCallback(async (mode: WindowMode) => {
    const result = await apiJson<{ window: WindowState }>('/api/window/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    })
    setExpanded(result.window.mode === 'panel')
    return result.window
  }, [])

  const flushWindowMove = useCallback(() => {
    dragFrameRef.current = null
    const next = dragPendingRef.current
    dragPendingRef.current = null
    if (!next) return
    apiJson<{ window: WindowState }>('/api/window/move', {
      method: 'POST',
      body: JSON.stringify(next),
    })
      .then((result) => {
        setStatus((current) => (current ? { ...current, window: result.window } : current))
      })
      .catch((error) => setLastError(error instanceof Error ? error.message : String(error)))
  }, [])

  const queueWindowMove = useCallback(
    (x: number, y: number) => {
      dragPendingRef.current = { x, y }
      if (dragFrameRef.current !== null) return
      dragFrameRef.current = window.requestAnimationFrame(flushWindowMove)
    },
    [flushWindowMove],
  )

  const startPetDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return
      const position = status?.window?.position
      if (!position) return
      dragStateRef.current = {
        pointerId: event.pointerId,
        startScreenX: event.screenX,
        startScreenY: event.screenY,
        startWindowX: position.x,
        startWindowY: position.y,
        moved: false,
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [status?.window?.position],
  )

  const movePetDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const drag = dragStateRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dx = event.screenX - drag.startScreenX
      const dy = event.screenY - drag.startScreenY
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true
      if (!drag.moved) return
      event.preventDefault()
      queueWindowMove(drag.startWindowX + dx, drag.startWindowY + dy)
    },
    [queueWindowMove],
  )

  const endPetDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragSuppressClickRef.current = drag.moved
    dragStateRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already be released by the browser.
    }
    window.setTimeout(() => {
      dragSuppressClickRef.current = false
    }, 0)
  }, [])

  useEffect(() => {
    let disposed = false
    let lastPanelDetailAt = 0
    const load = async () => {
      try {
        const next = await apiJson<Status>('/api/pet/status')
        if (disposed) return
        setStatus(next)
        if (next.window) setExpanded(next.window.mode === 'panel')
        setLastError('')
        const panelOpen = next.window?.mode === 'panel'
        const now = Date.now()
        if (panelOpen && now - lastPanelDetailAt >= PANEL_DETAIL_POLL_MS) {
          lastPanelDetailAt = now
          await loadPanelDetails()
        }
      } catch (error) {
        if (!disposed) {
          setLastError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void load()
    const id = window.setInterval(load, PET_STATUS_POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(id)
    }
  }, [loadPanelDetails])

  const toggleExpanded = useCallback(async () => {
    const next = !expanded
    try {
      const windowState = await setWindowMode(next ? 'panel' : 'pet')
      if (windowState.mode === 'panel') void loadPanelDetails()
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error))
    }
  }, [expanded, loadPanelDetails, setWindowMode])

  useEffect(() => () => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current)
      dragFrameRef.current = null
    }
  }, [])

  const openConfigCui = useCallback(async () => {
    try {
      await apiJson<{ ok: boolean; output: string }>('/api/config/open-cui', {
        method: 'POST',
        body: JSON.stringify({ source: 'pet' }),
      })
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const updateResidentConversation = useCallback((patch: Partial<ConversationState> & Record<string, unknown>) => {
    return apiJson<{ conversation: ConversationState }>('/api/conversation/state', {
      method: 'POST',
      body: JSON.stringify({ source: 'renderer', ...patch }),
    })
      .then((result) => {
        setStatus((current) => (current ? { ...current, conversation: result.conversation } : current))
        return result.conversation
      })
      .catch((error) => {
        setLastError(error instanceof Error ? error.message : String(error))
        return null
      })
  }, [])

  const recordRealtimeNegotiation = useCallback(
    async (payload: {
      sessionId: string
      micMode: MicMode
      offerBytes: number
      answerBytes: number
      statusCode: number
      ok: boolean
      durationMs: number
      error?: string
    }) => {
      const result = await apiJson<{ conversation: ConversationState }>('/api/realtime/session-negotiation', {
        method: 'POST',
        body: JSON.stringify({
          source: 'renderer',
          ...payload,
        }),
      })
      setStatus((current) => (current ? { ...current, conversation: result.conversation } : current))
      return result
    },
    [],
  )

  const recordRealtimeLatency = useCallback(
    async (patch: Record<string, unknown> = {}) => {
      const timeline = realtimeLatencyRef.current
      const sessionId = String(patch.sessionId || voiceSessionIdRef.current || '')
      if (!sessionId && !timeline.startedAt && !patch.startedAt) return null
      const result = await apiJson<{ latency: RealtimeLatencyReceipt; conversation: ConversationState }>('/api/realtime/latency', {
        method: 'POST',
        body: JSON.stringify({
          source: 'renderer',
          sessionId,
          micMode,
          screenLive,
          ...timeline,
          ...patch,
        }),
      })
      setStatus((current) => (current ? { ...current, conversation: result.conversation } : current))
      return result
    },
    [micMode, screenLive],
  )

  const stopVoice = useCallback((options: { report?: boolean } = {}) => {
    const voiceSessionId = voiceSessionIdRef.current
    if (options.report !== false && voiceSessionId && realtimeLatencyRef.current.startedAt) {
      const endedAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, endedAt }
      void recordRealtimeLatency({
        sessionId: voiceSessionId,
        status: 'ended',
        stage: 'ended',
        endedAt,
        screenLive: false,
      }).catch(() => {
        // Latency evidence is best-effort and should not block cleanup.
      })
    }
    if (initialScreenContextTimeoutRef.current !== null) {
      window.clearTimeout(initialScreenContextTimeoutRef.current)
      initialScreenContextTimeoutRef.current = null
    }
    dataChannelRef.current?.close()
    peerRef.current?.close()
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    dataChannelRef.current = null
    peerRef.current = null
    micStreamRef.current = null
    handledToolCallsRef.current.clear()
    previousPushStateRef.current = false
    responseActiveRef.current = false
    realtimeVoiceLiveStartedAtRef.current = 0
    realtimeLatencyRef.current = emptyRealtimeLatencyTimeline()
    voiceSessionIdRef.current = ''
    setIsPushingToTalk(false)
    voiceStatusRef.current = 'idle'
    setVoiceStatus('idle')
    if (options.report !== false) {
      void apiJson('/api/speech/stop', {
        method: 'POST',
        body: JSON.stringify({ source: 'renderer_stop' }),
      }).catch(() => {
        // Local speech is best-effort; realtime cleanup should not depend on it.
      })
      void updateResidentConversation({ status: 'idle', sessionId: voiceSessionId, screenLive: false })
    }
  }, [recordRealtimeLatency, updateResidentConversation])

  const runRealtimeTool = useCallback(
    async (event: Record<string, unknown>) => {
      const name = String(event.name || '')
      const callId = String(event.call_id || '')
      if (!name || !callId) return

      let args: unknown
      try {
        args = event.arguments ? JSON.parse(String(event.arguments)) : {}
      } catch {
        args = {}
      }

      addMessage('tool', `${name}()`)
      const result = await apiJson<{ ok: boolean; output: string }>('/api/tools/execute', {
        method: 'POST',
        body: JSON.stringify({ name, arguments: args }),
      })

      dataChannelRef.current?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result),
          },
        }),
      )
      dataChannelRef.current?.send(JSON.stringify({ type: 'response.create' }))
      refreshStatus()
    },
    [addMessage, refreshStatus],
  )

  const runRealtimeToolOnce = useCallback(
    (event: Record<string, unknown>) => {
      const callId = String(event.call_id || '')
      if (callId) {
        if (handledToolCallsRef.current.has(callId)) return
        handledToolCallsRef.current.add(callId)
      }
      runRealtimeTool(event).catch((error) => {
        addMessage('tool', error instanceof Error ? error.message : String(error))
      })
    },
    [addMessage, runRealtimeTool],
  )

  const handleRealtimeEvent = useCallback(
    (raw: MessageEvent<string>) => {
      try {
        const event = JSON.parse(raw.data)
        if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript) {
          addMessage('user', event.transcript)
        }
        if (event.type === 'response.created') {
          responseActiveRef.current = true
        }
        const assistantText = event.transcript || event.text
        if (
          (event.type === 'response.audio_transcript.done' ||
            event.type === 'response.output_audio_transcript.done' ||
            event.type === 'response.output_text.done') &&
          assistantText
        ) {
          addMessage('assistant', assistantText)
        }
        if (event.type === 'response.function_call_arguments.done') {
          runRealtimeToolOnce(event)
        }
        if (event.type === 'response.done' && Array.isArray(event.response?.output)) {
          responseActiveRef.current = false
          for (const output of event.response.output) {
            if (output?.type === 'function_call') runRealtimeToolOnce(output)
          }
        }
        if (event.type === 'response.cancelled' || event.type === 'response.failed') {
          responseActiveRef.current = false
        }
        if (event.type === 'error') {
          addMessage('system', event.error?.message || 'Realtime error')
        }
      } catch {
        // Realtime streams many small events; only JSON payloads matter here.
      }
    },
    [addMessage, runRealtimeToolOnce],
  )

  const speakLocal = useCallback(async (text: string) => {
    const cleanText = text.trim()
    if (!cleanText) return
    await apiJson('/api/speech/say', {
      method: 'POST',
      body: JSON.stringify({ text: cleanText, source: 'renderer_voice_fallback' }),
    })
  }, [])

  const fallbackIncludesScreen = Boolean(status?.screen)

  const runLocalVoiceFallback = useCallback(async () => {
    const prompt = quickInput.trim()
    try {
      if (!prompt) {
        const notice = '实时语音暂时连不上。我先切到本地语音；你可以在输入框里发消息。'
        addMessage('assistant', notice)
        await speakLocal(notice)
        return
      }

      setQuickInput('')
      addMessage('user', prompt)
      const result = await apiJson<{ output: string }>('/api/chat/quick', {
        method: 'POST',
        body: JSON.stringify({ message: prompt, includeScreen: fallbackIncludesScreen }),
      })
      const output = result.output?.trim() || '我没有拿到有效回复。'
      addMessage('assistant', output)
      await speakLocal(output)
    } catch (error) {
      addMessage('system', `本地语音兜底失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [addMessage, fallbackIncludesScreen, quickInput, speakLocal])

  const startVoice = useCallback(async (options: { screenLive?: boolean } = {}) => {
    const intendedScreenLive = options.screenLive ?? screenLive
    const voiceSessionId = crypto.randomUUID()
    const startedAt = Date.now()
    voiceSessionIdRef.current = voiceSessionId
    realtimeLatencyRef.current = { ...emptyRealtimeLatencyTimeline(), startedAt }
    setLastError('')
    voiceStatusRef.current = 'connecting'
    setVoiceStatus('connecting')
    await updateResidentConversation({ status: 'connecting', sessionId: voiceSessionId, micMode, screenLive: intendedScreenLive })
    void recordRealtimeLatency({
      sessionId: voiceSessionId,
      micMode,
      screenLive: intendedScreenLive,
      status: 'connecting',
      stage: 'starting',
      startedAt,
    }).catch(() => {
      // Latency evidence is best-effort; voice startup should not wait for it.
    })
    let negotiationStartedAt = 0
    let negotiationRecorded = false
    let offerBytes = 0
    let answerBytes = 0
    let statusCode = 0
    try {
      const peer = new RTCPeerConnection()
      peerRef.current = peer

      peer.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0]
        }
      }

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = micStream
      const micReadyAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, micReadyAt }
      void recordRealtimeLatency({
        sessionId: voiceSessionId,
        micMode,
        screenLive: intendedScreenLive,
        status: 'connecting',
        stage: 'mic_ready',
        micReadyAt,
      }).catch(() => null)
      micStream.getAudioTracks().forEach((track) => {
        track.enabled = micMode === 'open'
      })
      micStream.getTracks().forEach((track) => peer.addTrack(track, micStream))

      const dataChannel = peer.createDataChannel('oai-events')
      dataChannelRef.current = dataChannel
      dataChannel.addEventListener('open', () => {
        if (dataChannelRef.current !== dataChannel || voiceSessionIdRef.current !== voiceSessionId) return
        const dataChannelOpenAt = Date.now()
        realtimeVoiceLiveStartedAtRef.current = dataChannelOpenAt
        realtimeLatencyRef.current = { ...realtimeLatencyRef.current, dataChannelOpenAt }
        voiceStatusRef.current = 'live'
        setVoiceStatus('live')
        void updateResidentConversation({ status: 'live', sessionId: voiceSessionId, micMode, screenLive: intendedScreenLive })
        void recordRealtimeLatency({
          sessionId: voiceSessionId,
          micMode,
          screenLive: intendedScreenLive,
          status: 'live',
          stage: 'live',
          dataChannelOpenAt,
        }).catch(() => null)
        addMessage('system', 'Voice link live.')
        apiJson<{ context: RealtimePreflightContext }>('/api/realtime/context?source=renderer')
          .then((result) => {
            if (dataChannelRef.current !== dataChannel || dataChannel.readyState !== 'open') return
            if (result.context.enabled && result.context.prompt) {
              pushRealtimeTextContext(result.context.prompt)
            }
          })
          .catch((error) => {
            addMessage('tool', `Preflight context failed: ${error instanceof Error ? error.message : String(error)}`)
          })
        if (screenPreviewRef.current && realtimeScreenContextRef.current) {
          const fallbackFrame = screenFrameRef.current
          const fallbackWidth = status?.screen?.width || 0
          const fallbackHeight = status?.screen?.height || 0
          if (initialScreenContextTimeoutRef.current !== null) {
            window.clearTimeout(initialScreenContextTimeoutRef.current)
          }
          initialScreenContextTimeoutRef.current = window.setTimeout(() => {
            initialScreenContextTimeoutRef.current = null
            if (dataChannelRef.current !== dataChannel || dataChannel.readyState !== 'open' || !realtimeScreenContextRef.current) return
            const imageDataUrl = screenPreviewRef.current
            if (!imageDataUrl) return
            const frame = screenFrameRef.current || fallbackFrame
            pushRealtimeScreenContext(imageDataUrl, frame?.width || fallbackWidth, frame?.height || fallbackHeight, true)
          }, 250)
        }
      })
      dataChannel.addEventListener('message', handleRealtimeEvent)
      dataChannel.addEventListener('close', () => {
        if (dataChannelRef.current !== dataChannel || voiceSessionIdRef.current !== voiceSessionId) return
        const endedAt = Date.now()
        realtimeLatencyRef.current = { ...realtimeLatencyRef.current, endedAt }
        void recordRealtimeLatency({
          sessionId: voiceSessionId,
          micMode,
          screenLive: false,
          status: 'ended',
          stage: 'ended',
          endedAt,
        }).catch(() => null)
        setVoiceStatus((current) => {
          const next = current === 'live' ? 'idle' : current
          voiceStatusRef.current = next
          return next
        })
        voiceSessionIdRef.current = ''
        realtimeVoiceLiveStartedAtRef.current = 0
        realtimeLatencyRef.current = emptyRealtimeLatencyTimeline()
        void updateResidentConversation({ status: 'idle', sessionId: voiceSessionId, micMode, screenLive: false })
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      const offerCreatedAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, offerCreatedAt }
      offerBytes = utf8Bytes(offer.sdp || '')
      negotiationStartedAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, negotiationStartedAt }
      void recordRealtimeLatency({
        sessionId: voiceSessionId,
        micMode,
        screenLive: intendedScreenLive,
        status: 'connecting',
        stage: 'negotiating',
        offerCreatedAt,
        negotiationStartedAt,
      }).catch(() => null)
      const response = await fetch(`${API_BASE}/api/realtime/session?micMode=${micMode}`, {
        method: 'POST',
        body: offer.sdp,
        headers: apiHeaders(undefined, 'application/sdp'),
      })
      statusCode = response.status
      const answerSdp = await response.text()
      const answerReceivedAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, answerReceivedAt }
      answerBytes = utf8Bytes(answerSdp)
      if (!response.ok) {
        await recordRealtimeNegotiation({
          sessionId: voiceSessionId,
          micMode,
          offerBytes,
          answerBytes,
          statusCode,
          ok: false,
          durationMs: Math.max(0, Date.now() - negotiationStartedAt),
          error: answerSdp || response.statusText,
        }).catch(() => null)
        negotiationRecorded = true
        throw new Error(answerSdp || response.statusText)
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      const remoteDescriptionAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, remoteDescriptionAt }
      void recordRealtimeLatency({
        sessionId: voiceSessionId,
        micMode,
        screenLive: intendedScreenLive,
        status: 'connecting',
        stage: 'answer_received',
        answerReceivedAt,
        remoteDescriptionAt,
      }).catch(() => null)
      await recordRealtimeNegotiation({
        sessionId: voiceSessionId,
        micMode,
        offerBytes,
        answerBytes,
        statusCode,
        ok: true,
        durationMs: Math.max(0, Date.now() - negotiationStartedAt),
      })
        .then(() => {
          negotiationRecorded = true
        })
        .catch((recordError) => {
          addMessage('tool', `Realtime negotiation evidence failed: ${recordError instanceof Error ? recordError.message : String(recordError)}`)
        })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const errorAt = Date.now()
      realtimeLatencyRef.current = { ...realtimeLatencyRef.current, errorAt }
      await recordRealtimeLatency({
        sessionId: voiceSessionId,
        micMode,
        screenLive: intendedScreenLive,
        status: 'error',
        stage: 'error',
        ok: false,
        error: message,
        errorAt,
      }).catch(() => null)
      stopVoice({ report: false })
      voiceStatusRef.current = 'error'
      setVoiceStatus('error')
      if (negotiationStartedAt && !negotiationRecorded) {
        await recordRealtimeNegotiation({
          sessionId: voiceSessionId,
          micMode,
          offerBytes,
          answerBytes,
          statusCode,
          ok: false,
          durationMs: Math.max(0, Date.now() - negotiationStartedAt),
          error: message,
        }).catch(() => null)
      }
      void updateResidentConversation({ status: 'error', sessionId: voiceSessionId, micMode, screenLive: intendedScreenLive, error: message })
      setLastError(message)
      addMessage('system', message)
      void runLocalVoiceFallback()
    }
  }, [addMessage, handleRealtimeEvent, micMode, pushRealtimeScreenContext, pushRealtimeTextContext, recordRealtimeLatency, recordRealtimeNegotiation, runLocalVoiceFallback, screenLive, status?.screen?.height, status?.screen?.width, stopVoice, updateResidentConversation])

  useEffect(() => {
    if (voiceStatus !== 'live') return undefined
    const id = window.setInterval(() => {
      void updateResidentConversation({ status: 'live', sessionId: voiceSessionIdRef.current, micMode, screenLive, heartbeat: true })
    }, 15000)
    return () => window.clearInterval(id)
  }, [micMode, screenLive, updateResidentConversation, voiceStatus])

  const syncRealtimeWorkProgress = useCallback(
    async (reason = 'interval', force = false) => {
      if (voiceStatus !== 'live') return false
      try {
        const result = await apiJson<{ progress: WorkProgress }>('/api/work/progress?jobLimit=5&workflowLimit=5')
        const version = result.progress.version
        const sequence = Number(version?.sequence || 0)
        if (sequence) lastRealtimeWorkProgressSequenceRef.current = Math.max(lastRealtimeWorkProgressSequenceRef.current, sequence)
        const liveStartedAt = realtimeVoiceLiveStartedAtRef.current || Date.now()
        const contextText = realtimeWorkProgressContext(result.progress, liveStartedAt)
        if (!contextText) return false
        const signature = contextText
        if (signature === lastRealtimeWorkProgressSignatureRef.current) return false
        const now = Date.now()
        const minGapMs = force ? 0 : 10000
        if (now - lastRealtimeWorkProgressSyncAtRef.current < minGapMs) return false
        if (pushRealtimeTextContext(contextText)) {
          const dataChannelReadyState = dataChannelRef.current?.readyState || ''
          void apiJson<{ ok?: boolean; conversation: ConversationState }>('/api/realtime/progress-injection', {
            method: 'POST',
            body: JSON.stringify({
              source: reason === 'progress_version' ? 'renderer_progress_version' : 'renderer',
              sessionId: voiceSessionIdRef.current,
              transport: 'webrtc-datachannel',
              dataChannelReadyState,
              eventType: 'conversation.item.create',
              eventRole: 'user',
              contentType: 'input_text',
              forcedResponse: false,
              responseActive: responseActiveRef.current,
              voiceStatus,
              micMode,
              screenLive,
              ...realtimeProgressInjectionEvidence(result.progress, contextText),
            }),
          })
            .then((injectionResult) => {
              setStatus((current) => (current ? { ...current, conversation: injectionResult.conversation } : current))
              if (injectionResult.ok !== false && !realtimeLatencyRef.current.firstProgressInjectionAt) {
                const firstProgressInjectionAt = Date.now()
                realtimeLatencyRef.current = { ...realtimeLatencyRef.current, firstProgressInjectionAt }
                void recordRealtimeLatency({
                  sessionId: voiceSessionIdRef.current,
                  micMode,
                  screenLive,
                  status: 'live',
                  stage: 'progress_injected',
                  firstProgressInjectionAt,
                }).catch(() => null)
              }
            })
            .catch(() => {
              // Runtime evidence is best-effort; Realtime context should keep flowing.
            })
          lastRealtimeWorkProgressSignatureRef.current = signature
          lastRealtimeWorkProgressSyncAtRef.current = now
          return true
        }
      } catch {
        // Work-progress sync is opportunistic context; voice should keep running.
      }
      return false
    },
    [micMode, pushRealtimeTextContext, recordRealtimeLatency, screenLive, voiceStatus],
  )

  useEffect(() => {
    if (voiceStatus !== 'live') {
      lastRealtimeWorkProgressSignatureRef.current = ''
      lastRealtimeWorkProgressSyncAtRef.current = 0
      lastRealtimeWorkProgressSequenceRef.current = 0
      realtimeVoiceLiveStartedAtRef.current = 0
      return undefined
    }

    if (!realtimeVoiceLiveStartedAtRef.current) realtimeVoiceLiveStartedAtRef.current = Date.now()
    const timeout = window.setTimeout(
      () => void syncRealtimeWorkProgress('live_start', true),
      Math.min(REALTIME_WORK_PROGRESS_SYNC_MS, 30000),
    )
    const interval = window.setInterval(
      () => void syncRealtimeWorkProgress('interval'),
      REALTIME_WORK_PROGRESS_SYNC_MS,
    )
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [syncRealtimeWorkProgress, voiceStatus])

  useEffect(() => {
    const sequence = Number(status?.progressVersion?.sequence || 0)
    if (voiceStatus !== 'live' || !sequence) return
    if (sequence <= lastRealtimeWorkProgressSequenceRef.current) return
    void syncRealtimeWorkProgress('progress_version', true)
  }, [status?.progressVersion?.sequence, syncRealtimeWorkProgress, voiceStatus])

  useEffect(() => {
    if (voiceStatus !== 'live') return
    setMicTracksEnabled(micMode === 'open' || isPushingToTalk)
  }, [isPushingToTalk, micMode, setMicTracksEnabled, voiceStatus])

  useEffect(() => {
    if (voiceStatus !== 'live' || micMode !== 'push') {
      previousPushStateRef.current = false
      return
    }

    const wasPushing = previousPushStateRef.current
    if (isPushingToTalk && !wasPushing) {
      if (responseActiveRef.current) {
        sendRealtimeEvent({ type: 'response.cancel' })
        sendRealtimeEvent({ type: 'output_audio_buffer.clear' })
      }
      sendRealtimeEvent({ type: 'input_audio_buffer.clear' })
    }

    if (!isPushingToTalk && wasPushing) {
      sendRealtimeEvent({ type: 'input_audio_buffer.commit' })
      sendRealtimeEvent({ type: 'response.create' })
    }

    previousPushStateRef.current = isPushingToTalk
  }, [isPushingToTalk, micMode, sendRealtimeEvent, voiceStatus])

  useEffect(() => {
    if (voiceStatus !== 'live' || micMode !== 'push') return undefined

    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditable(event.target)) return
      event.preventDefault()
      setIsPushingToTalk(true)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      event.preventDefault()
      setIsPushingToTalk(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [micMode, voiceStatus])

  const captureFrame = useCallback(
    async (describe = false, options: { refresh?: boolean } = {}) => {
      const result = await apiJson<{ ok: boolean; screen: NonNullable<Status['screen']> }>('/api/screen/capture-now', {
        method: 'POST',
        body: JSON.stringify({ includeImage: true, source: 'renderer' }),
      })
      const frame = result.screen
      const imageDataUrl = frame.imageDataUrl || ''
      if (!imageDataUrl) return
      setScreenPreview(imageDataUrl)
      screenPreviewRef.current = imageDataUrl
      screenFrameRef.current = { width: frame.width, height: frame.height }

      if (frame.privacy?.realtimeAllowed !== false) {
        pushRealtimeScreenContext(imageDataUrl, frame.width, frame.height, describe)
      }

      if (describe) {
        const result = await apiJson<{ output: string }>('/api/screen/describe', {
          method: 'POST',
          body: JSON.stringify({ capture: false, prompt: 'Describe the current screen and the next useful action.' }),
        })
        addMessage('assistant', result.output)
      }
      if (options.refresh !== false) refreshStatus()
    },
    [addMessage, pushRealtimeScreenContext, refreshStatus],
  )

  const startScreen = useCallback(async (options: { describe?: boolean } = {}) => {
    const describe = options.describe ?? true
    setLastError('')
    try {
      setScreenLive(true)
      void updateResidentConversation({ screenLive: true, micMode })
      await captureFrame(describe)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setScreenLive(false)
      void updateResidentConversation({ screenLive: false, micMode })
      setLastError(message)
      addMessage('system', message)
      return false
    }
  }, [addMessage, captureFrame, micMode, updateResidentConversation])

  const stopScreen = useCallback(() => {
    setScreenLive(false)
    setScreenPreview('')
    screenPreviewRef.current = ''
    screenFrameRef.current = null
    void updateResidentConversation({ screenLive: false, micMode })
    void apiJson('/api/screen/frame', {
      method: 'DELETE',
      body: JSON.stringify({ source: 'renderer' }),
    }).catch((error) => setLastError(error instanceof Error ? error.message : String(error)))
  }, [micMode, updateResidentConversation])

  const beginAssistantSession = useCallback(async () => {
    if (voiceStatus === 'connecting' || voiceStatus === 'live') return
    if (!screenLive) {
      void startScreen({ describe: false })
    }
    await startVoice({ screenLive: true })
  }, [screenLive, startScreen, startVoice, voiceStatus])

  const postRendererDogfoodEventRef = useRef(postRendererDogfoodEvent)
  const sendRealtimeUserTextRef = useRef(sendRealtimeUserText)
  const startScreenRef = useRef(startScreen)
  const startVoiceRef = useRef(startVoice)
  const stopVoiceRef = useRef(stopVoice)

  useEffect(() => {
    postRendererDogfoodEventRef.current = postRendererDogfoodEvent
    sendRealtimeUserTextRef.current = sendRealtimeUserText
    startScreenRef.current = startScreen
    startVoiceRef.current = startVoice
    stopVoiceRef.current = stopVoice
  }, [postRendererDogfoodEvent, sendRealtimeUserText, startScreen, startVoice, stopVoice])

  useEffect(() => {
    let disposed = false

    const waitForDataChannel = async (timeoutMs: number) => {
      const deadline = Date.now() + Math.max(1000, timeoutMs)
      while (!disposed && Date.now() < deadline) {
        if (dataChannelRef.current?.readyState === 'open') return true
        if (voiceStatusRef.current === 'error') return false
        await sleep(500)
      }
      return false
    }

    const handleRendererDogfood = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<RealtimeRendererDogfoodCommand>
      const detail = event.detail || {}
      if (detail.action !== 'start') return
      const runId = detail.runId || crypto.randomUUID()
      const prompts = Array.isArray(detail.prompts) ? detail.prompts.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8) : []
      const promptDelayMs = Math.max(0, Math.min(180000, Number(detail.promptDelayMs || 35000)))
      const betweenPromptsMs = Math.max(1000, Math.min(60000, Number(detail.betweenPromptsMs || 9000)))
      const stopAfterMs = Math.max(0, Math.min(300000, Number(detail.stopAfterMs || 0)))

      void (async () => {
        await postRendererDogfoodEventRef.current({
          runId,
          type: 'received',
          status: 'starting',
          detail: 'Renderer received Realtime dogfood start command.',
          sessionId: voiceSessionIdRef.current,
        })
        try {
          if (voiceStatusRef.current !== 'live' && voiceStatusRef.current !== 'connecting') {
            if (!screenLiveRef.current) {
              void startScreenRef.current({ describe: false })
            }
            await startVoiceRef.current({ screenLive: true })
          }

          const live = await waitForDataChannel(90000)
          if (!live) {
            const voiceErrored = voiceStatusRef.current === 'error'
            await postRendererDogfoodEventRef.current({
              runId,
              type: voiceErrored ? 'voice_error' : 'timeout',
              status: voiceErrored ? 'error' : 'timeout',
              detail: voiceErrored
                ? 'Realtime voice entered error before the data channel opened.'
                : 'Timed out waiting for Realtime data channel to open.',
              sessionId: voiceSessionIdRef.current,
            })
            return
          }

          await postRendererDogfoodEventRef.current({
            runId,
            type: 'live',
            status: 'live',
            detail: 'Realtime data channel is open.',
            sessionId: voiceSessionIdRef.current,
          })

          if (promptDelayMs) await sleep(promptDelayMs)
          for (const prompt of prompts) {
            if (disposed || dataChannelRef.current?.readyState !== 'open') break
            const sent = sendRealtimeUserTextRef.current(prompt)
            await postRendererDogfoodEventRef.current({
              runId,
              type: sent ? 'prompt_sent' : 'prompt_failed',
              status: sent ? 'prompt_sent' : 'error',
              prompt,
              detail: sent ? 'Prompt sent into live Realtime session.' : 'Realtime data channel was not open for prompt.',
              sessionId: voiceSessionIdRef.current,
            })
            if (!sent) return
            await sleep(betweenPromptsMs)
          }

          await postRendererDogfoodEventRef.current({
            runId,
            type: 'prompts_complete',
            status: 'prompts_complete',
            detail: `${prompts.length} prompt(s) processed.`,
            sessionId: voiceSessionIdRef.current,
          })

          if (stopAfterMs) {
            await sleep(stopAfterMs)
            if (!disposed && dataChannelRef.current?.readyState === 'open') {
              await postRendererDogfoodEventRef.current({
                runId,
                type: 'stopping',
                status: 'stopping',
                detail: 'Stopping Realtime dogfood session after requested delay.',
                sessionId: voiceSessionIdRef.current,
              })
              stopVoiceRef.current()
              await postRendererDogfoodEventRef.current({
                runId,
                type: 'stopped',
                status: 'stopped',
                detail: 'Realtime dogfood session stopped.',
                sessionId: voiceSessionIdRef.current,
              })
            }
          }
        } catch (error) {
          await postRendererDogfoodEventRef.current({
            runId,
            type: 'error',
            status: 'error',
            detail: error instanceof Error ? error.message : String(error),
            sessionId: voiceSessionIdRef.current,
          })
        }
      })()
    }

    window.addEventListener('javis:realtime-dogfood', handleRendererDogfood as EventListener)
    return () => {
      disposed = true
      window.removeEventListener('javis:realtime-dogfood', handleRendererDogfood as EventListener)
    }
  }, [])

  const startAssistantSession = useCallback(async () => {
    if (voiceStatus === 'connecting') return
    if (voiceStatus === 'live' || screenLive) {
      stopVoice()
      stopScreen()
      return
    }

    await beginAssistantSession()
  }, [beginAssistantSession, screenLive, stopScreen, stopVoice, voiceStatus])

  useEffect(() => {
    const wake = status?.wake
    if (!wake?.pending || !wake.lastTriggerAt || wake.lastTriggerAt <= lastWakeHandledAtRef.current) return
    lastWakeHandledAtRef.current = wake.lastTriggerAt
    addMessage('system', `Wake: ${wake.lastPhrase || wake.lastSource || 'triggered'}`)
    void beginAssistantSession()
  }, [addMessage, beginAssistantSession, status?.wake])

  useEffect(() => {
    if (!screenLive) return undefined
    const intervalMs = voiceStatus === 'live' ? SCREEN_CONTEXT_LIVE_POLL_MS : SCREEN_CONTEXT_IDLE_POLL_MS
    const id = window.setInterval(() => {
      captureFrame(false, { refresh: false }).catch((error) => setLastError(error instanceof Error ? error.message : String(error)))
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [captureFrame, screenLive, voiceStatus])

  const sendQuick = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const message = quickInput.trim()
      if (!message) return
      setQuickInput('')
      setBusy(true)
      addMessage('user', message)
      try {
        const result = await apiJson<TaskRouteResult>('/api/tasks/route', {
          method: 'POST',
          body: JSON.stringify({ message, includeScreen: Boolean(status?.screen), execute: true }),
        })
        if (result.queued && result.job) {
          addMessage('system', result.output || `Routed to ${result.decision.label}: ${result.job.title}`)
          refreshStatus()
        } else {
          addMessage(result.ok ? 'assistant' : 'system', result.output)
        }
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(false)
      }
    },
    [addMessage, quickInput, refreshStatus, status],
  )

  const enqueueTask = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      const task = taskInput.trim()
      if (!task) return
      setTaskInput('')
      try {
        const result = await apiJson<{ job: Job }>('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({ task, mode: taskMode }),
        })
        addMessage('system', `Queued ${result.job.mode}: ${result.job.title}`)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
      }
    },
    [addMessage, refreshStatus, taskInput, taskMode],
  )

  const approveAction = useCallback(
    async (id: string) => {
      try {
        const result = await apiJson<{ output: string }>(`/api/approvals/${id}/approve`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        addMessage('system', result.output || 'Approved action.')
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      }
    },
    [addMessage, refreshStatus],
  )

  const rejectAction = useCallback(
    async (id: string) => {
      try {
        await apiJson(`/api/approvals/${id}/reject`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Rejected from buddy panel.' }),
        })
        addMessage('system', 'Rejected action.')
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      }
    },
    [addMessage, refreshStatus],
  )

  const cancelJob = useCallback(
    async (id: string) => {
      try {
        const result = await apiJson<{ job: Job }>(`/api/jobs/${id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Cancelled from buddy panel.' }),
        })
        addMessage('system', `Cancelled: ${result.job.title}`)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      }
    },
    [addMessage, refreshStatus],
  )

  const completeInboxItem = useCallback(
    async (id: string) => {
      try {
        const result = await apiJson<{ item: InboxItem }>(`/api/inbox/${id}/complete`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        addMessage('system', `Completed inbox: ${result.item.title}`)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      }
    },
    [addMessage, refreshStatus],
  )

  const routeInboxItem = useCallback(
    async (id: string) => {
      setRoutingInboxId(id)
      try {
        const result = await apiJson<{
          ok: boolean
          item: InboxItem
          output: string
          route: TaskRouteResult
        }>(`/api/inbox/${id}/route`, {
          method: 'POST',
          body: JSON.stringify({ execute: true, includeScreen: Boolean(status?.screen) }),
        })
        const routed = result.route?.decision?.label || 'task'
        const message = result.output || result.route?.output || `Routed inbox to ${routed}.`
        addMessage(result.ok && !result.route?.queued ? 'assistant' : 'system', message)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      } finally {
        setRoutingInboxId('')
      }
    },
    [addMessage, refreshStatus, status],
  )

  const triageInbox = useCallback(async () => {
    setTriageInboxBusy(true)
    try {
      const result = await apiJson<{ triage: InboxTriage }>('/api/inbox/triage?limit=8')
      addMessage('system', result.triage.output)
      refreshStatus()
    } catch (error) {
      addMessage('system', error instanceof Error ? error.message : String(error))
      refreshStatus()
    } finally {
      setTriageInboxBusy(false)
    }
  }, [addMessage, refreshStatus])

  const processNextInbox = useCallback(async () => {
    setProcessingNextInbox(true)
    try {
      const result = await apiJson<ProcessNextInboxResult>('/api/inbox/process-next', {
        method: 'POST',
        body: JSON.stringify({ execute: true, includeScreen: Boolean(status?.screen) }),
      })
      addMessage(result.ok && !result.route?.queued ? 'assistant' : 'system', result.output || 'Processed next Inbox item.')
      refreshStatus()
    } catch (error) {
      addMessage('system', error instanceof Error ? error.message : String(error))
      refreshStatus()
    } finally {
      setProcessingNextInbox(false)
    }
  }, [addMessage, refreshStatus, status])

  const endActiveSession = useCallback(
    async (id: string) => {
      setEndingSessionId(id)
      try {
        const result = await apiJson<{ session: WorkSession }>(`/api/sessions/${id}/end`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        addMessage('system', `Ended session: ${result.session.title}`)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      } finally {
        setEndingSessionId('')
      }
    },
    [addMessage, refreshStatus],
  )

  const runSessionCheckIn = useCallback(
    async (id: string) => {
      setCheckingSessionId(id)
      try {
        const result = await apiJson<{ checkIn: SessionCheckIn }>('/api/sessions/check-in?limit=4')
        addMessage('system', result.checkIn.output)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      } finally {
        setCheckingSessionId('')
      }
    },
    [addMessage, refreshStatus],
  )

  const resumeSession = useCallback(
    async (id: string) => {
      setResumingSessionId(id)
      try {
        const result = await apiJson<{ session: WorkSession; previous: WorkSession; checkIn: SessionCheckIn }>(`/api/sessions/${id}/resume`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        addMessage('system', `Resumed session: ${result.session.title}\n${result.checkIn.output}`)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      } finally {
        setResumingSessionId('')
      }
    },
    [addMessage, refreshStatus],
  )

  const runSetupAction = useCallback(
    async (action: SetupAction) => {
      setSetupBusy(action)
      try {
        const result = await apiJson<{ output: string; config?: ConfigCheck }>('/api/setup/actions', {
          method: 'POST',
          body: JSON.stringify({ action }),
        })
        addMessage('system', result.output)
        if (result.config) setConfigCheck(result.config)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
      } finally {
        setSetupBusy('')
      }
    },
    [addMessage, refreshStatus],
  )

  const runSetupNext = useCallback(async () => {
    setSetupNextBusy(true)
    try {
      const result = await apiJson<{ output: string; guide: SetupGuide; actionResult: { action: SetupAction } | null }>('/api/setup/next', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      addMessage('system', result.output)
      refreshStatus()
    } catch (error) {
      addMessage('system', error instanceof Error ? error.message : String(error))
    } finally {
      setSetupNextBusy(false)
    }
  }, [addMessage, refreshStatus])

  const updateScreenPrivacy = useCallback(
    async (mode: ScreenPrivacy['mode']) => {
      try {
        const result = await apiJson<{ privacy: ScreenPrivacy }>('/api/screen/privacy', {
          method: 'PUT',
          body: JSON.stringify({ mode }),
        })
        setStatus((current) => (current ? { ...current, screenPrivacy: result.privacy } : current))
        addMessage('system', `Screen privacy: ${result.privacy.label}`)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
        refreshStatus()
      }
    },
    [addMessage, refreshStatus],
  )

  const runDoctorReport = useCallback(async () => {
    setDoctorBusy(true)
    try {
      const doctor = await loadDoctorReport()
      addMessage(
        doctor.overall === 'ready' ? 'system' : 'tool',
        `${doctor.label}: ${doctor.counts.ready}/${doctor.counts.total} ready · ${doctor.summary}`,
      )
      setLastError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      addMessage('system', message)
    } finally {
      setDoctorBusy(false)
    }
  }, [addMessage, loadDoctorReport])

  const runWorkBriefing = useCallback(async () => {
    setBriefingBusy(true)
    try {
      const briefing = await loadWorkBriefing()
      addMessage(briefing.ok ? 'system' : 'tool', briefing.summary)
      setLastError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      addMessage('system', message)
    } finally {
      setBriefingBusy(false)
    }
  }, [addMessage, loadWorkBriefing])

  const runWorkProgress = useCallback(async () => {
    setProgressBusy(true)
    try {
      const result = await apiJson<{ progress: WorkProgress }>('/api/work/progress?jobLimit=5&workflowLimit=5')
      addMessage('system', result.progress.output)
      setLastError('')
      refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      addMessage('system', message)
      refreshStatus()
    } finally {
      setProgressBusy(false)
    }
  }, [addMessage, refreshStatus])

  const runWorkNext = useCallback(async () => {
    setWorkNextBusy(true)
    try {
      const result = await apiJson<{ next: WorkNextResult }>('/api/work/next', {
        method: 'POST',
        body: JSON.stringify({ execute: true, includeScreen: Boolean(status?.screen) }),
      })
      addMessage(result.next.executed ? 'system' : 'tool', result.next.output)
      setLastError('')
      refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      addMessage('system', message)
      refreshStatus()
    } finally {
      setWorkNextBusy(false)
    }
  }, [addMessage, refreshStatus, status])

  const runBrowserWorkflow = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      setBrowserBusy(true)
      try {
        const browserText = browserInstruction.trim()
        const browserQueries = browserIntent === 'compare'
          ? browserText.split(/\n|;|；|\s+\|\s+/).map((item) => item.trim()).filter(Boolean)
          : []
        const result = await apiJson<BrowserWorkflowResult>('/api/browser/workflow', {
          method: 'POST',
          body: JSON.stringify({
            intent: browserIntent,
            mode: browserMode,
            instruction: browserText,
            query: browserIntent === 'search' || browserIntent === 'review_result' || browserIntent === 'research' ? browserText : undefined,
            queries: browserQueries.length ? browserQueries : undefined,
            maxChars: browserMode === 'quick' ? 12000 : 30000,
            execute: browserIntent === 'act' || browserIntent === 'search' || browserIntent === 'compare' || browserIntent === 'review_result' || browserIntent === 'research',
            maxSteps: 5,
          }),
        })
        if (result.queued && result.job) {
          addMessage('system', `Queued page ${result.intent}: ${result.job.title}`)
        } else {
          addMessage(result.ok ? 'assistant' : 'system', result.output)
        }
        if (browserText) setBrowserInstruction('')
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
      } finally {
        setBrowserBusy(false)
      }
    },
    [addMessage, browserInstruction, browserIntent, browserMode, refreshStatus],
  )

  const copyWorkflowResult = useCallback(
    async (workflowId: string) => {
      setCopyingWorkflowId(workflowId)
      try {
        const result = await apiJson<{ ok: boolean; output: string; bytes?: number }>(
          `/api/workflows/${encodeURIComponent(workflowId)}/copy-result`,
          {
            method: 'POST',
            body: JSON.stringify({ format: 'markdown' }),
          },
        )
        addMessage('system', result.ok ? `Copied workflow result (${result.bytes || 0} bytes).` : result.output)
        refreshStatus()
      } catch (error) {
        addMessage('system', error instanceof Error ? error.message : String(error))
      } finally {
        setCopyingWorkflowId('')
      }
    },
    [addMessage, refreshStatus],
  )

  const inspectAccessibilityTree = useCallback(async () => {
    setAccessibilityBusy('tree')
    try {
      const result = await apiJson<{ tree: AccessibilityTree }>('/api/accessibility/tree?maxNodes=80&maxDepth=5')
      const tree = result.tree
      const summary = tree.available
        ? `${tree.app || 'App'} · ${tree.nodeCount} UI nodes${tree.truncated ? ' · truncated' : ''}`
        : tree.error || 'UI tree unavailable'
      setAccessibilitySummary(summary)
      addMessage(tree.available ? 'system' : 'tool', summary)
      refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAccessibilitySummary(message)
      addMessage('system', message)
    } finally {
      setAccessibilityBusy('')
    }
  }, [addMessage, refreshStatus])

  const planUiAction = useCallback(async () => {
    const instruction = quickInput.trim() || 'Suggest the safest next UI action for the current app.'
    setAccessibilityBusy('plan')
    try {
      const plan = await apiJson<AccessibilityPlan>('/api/accessibility/plan', {
        method: 'POST',
        body: JSON.stringify({ instruction, maxNodes: 100, maxDepth: 6 }),
      })
      const summary = plan.recommended?.summary || plan.tree?.error || 'No UI plan available.'
      setAccessibilitySummary(`${plan.app || 'App'} · ${summary}`)
      setAccessibilityTarget(
        plan.recommended?.nodeId
          ? {
              nodeId: plan.recommended.nodeId,
              role: plan.recommended.role || '',
              label: plan.recommended.label || '',
            }
          : null,
      )
      addMessage(plan.ok ? 'system' : 'tool', `${summary} ${plan.recommended?.nextStep || ''}`.trim())
      refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAccessibilitySummary(message)
      addMessage('system', message)
    } finally {
      setAccessibilityBusy('')
    }
  }, [addMessage, quickInput, refreshStatus])

  const previewAccessibilityAction = useCallback(async () => {
    if (!accessibilityTarget) {
      const message = 'Run Plan first.'
      setAccessibilitySummary(message)
      addMessage('system', message)
      return
    }
    setAccessibilityBusy('guard')
    try {
      const result = await apiJson<{
        ok: boolean
        error?: string
        plan?: { summary: string }
        evaluation?: { blocked?: boolean; needsApproval?: boolean; reason?: string }
      }>('/api/actions/preview', {
        method: 'POST',
        body: JSON.stringify({
          action: 'ax_press',
          nodeId: accessibilityTarget.nodeId,
          expectedRole: accessibilityTarget.role,
          expectedLabel: accessibilityTarget.label,
          maxNodes: 100,
          maxDepth: 6,
        }),
      })
      const reason = result.evaluation?.reason || result.error || 'ready'
      const summary = result.ok ? `${result.plan?.summary || 'AX action'} · ${reason}` : reason
      setAccessibilitySummary(summary)
      addMessage(result.ok ? 'system' : 'tool', summary)
      refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAccessibilitySummary(message)
      addMessage('system', message)
    } finally {
      setAccessibilityBusy('')
    }
  }, [accessibilityTarget, addMessage, refreshStatus])

  const requestAccessibilityAction = useCallback(async () => {
    if (!accessibilityTarget) {
      const message = 'Run Plan first.'
      setAccessibilitySummary(message)
      addMessage('system', message)
      return
    }
    setAccessibilityBusy('act')
    try {
      const result = await apiJson<{
        ok: boolean
        output: string
        approval?: { id: string; summary: string }
      }>('/api/actions/execute', {
        method: 'POST',
        body: JSON.stringify({
          action: 'ax_press',
          nodeId: accessibilityTarget.nodeId,
          expectedRole: accessibilityTarget.role,
          expectedLabel: accessibilityTarget.label,
          maxNodes: 100,
          maxDepth: 6,
        }),
      })
      const summary = result.approval
        ? `Approval queued: ${result.approval.summary}`
        : result.output || 'Action requested.'
      setAccessibilitySummary(summary)
      addMessage(result.ok ? 'system' : 'tool', summary)
      refreshStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setAccessibilitySummary(message)
      addMessage('system', message)
      refreshStatus()
    } finally {
      setAccessibilityBusy('')
    }
  }, [accessibilityTarget, addMessage, refreshStatus])

  const latestLine = useMemo(() => {
    const found = [...messages].reverse().find((message) => message.role === 'assistant' || message.role === 'system')
    return found?.text || 'Ready.'
  }, [messages])

  const presence = status?.presence
  const mood = useMemo<PetMood>(() => {
    if (!status?.api.hasOpenAiKey) return 'needs-key'
    if (presence?.mode === 'setup_blocked' || presence?.mode === 'voice_error' || readiness?.overall === 'blocked') return 'attention'
    if (presence?.mode === 'needs_attention' || approvals.length > 0) return 'attention'
    if (voiceStatus === 'connecting' || presence?.mode === 'connecting' || presence?.mode === 'waking') return 'thinking'
    if (voiceStatus === 'live' || presence?.mode === 'listening') return 'listening'
    if (activeJobCount > 0 || presence?.mode === 'working') return 'thinking'
    if (screenLive || presence?.mode === 'watching') return 'watching'
    if (presence?.mode === 'standby') return 'standby'
    return 'ready'
  }, [activeJobCount, approvals.length, presence?.mode, readiness?.overall, screenLive, status?.api.hasOpenAiKey, voiceStatus])

  const voiceAction = useCallback(() => {
    if (voiceStatus === 'idle' || voiceStatus === 'error') {
      void startVoice()
      return
    }
    stopVoice()
  }, [startVoice, stopVoice, voiceStatus])
  const screenAction = useCallback(() => {
    if (screenLive) {
      stopScreen()
      return
    }
    void startScreen({ describe: true })
  }, [screenLive, startScreen, stopScreen])
  const talking = voiceStatus === 'live' && (micMode === 'open' || isPushingToTalk)
  const petAction = status?.api.hasOpenAiKey ? startAssistantSession : openConfigCui
  const petStatusLabel = petMoodLabel(mood, presence, talking)
  const petStatusDetail = presence?.intervention?.next || latestLine || 'Click to talk. Right-click for config.'
  const petActionLabel = !status?.api.hasOpenAiKey
    ? 'Open JAVIS config'
    : voiceStatus === 'live' || screenLive
      ? 'Stop JAVIS voice and screen'
      : voiceStatus === 'connecting'
        ? 'Connecting JAVIS'
        : 'Talk to JAVIS with screen'

  return (
    <main className={`pet-shell ${expanded ? 'expanded' : 'compact'} mood-${mood}`}>
      <audio ref={audioRef} autoPlay />

      <div className="drag-handle" />

      <section className="pet-stage" aria-label="JAVIS desktop buddy">
        <button
          type="button"
          className="pet-body voice-capsule no-drag"
          onPointerDown={startPetDrag}
          onPointerMove={movePetDrag}
          onPointerUp={endPetDrag}
          onPointerCancel={endPetDrag}
          onClick={() => {
            if (dragSuppressClickRef.current) return
            petAction()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            void openConfigCui()
          }}
          disabled={voiceStatus === 'connecting'}
          aria-label={`${petStatusLabel}. ${petActionLabel}`}
          title={`${petStatusLabel}. ${petStatusDetail} Click to talk. Right-click for config.`}
        >
          <span className="island-glow" aria-hidden="true" />
          <span className="island-lights" aria-hidden="true">
            <span className="island-light light-red" />
            <span className="island-light light-yellow" />
            <span className="island-light light-green" />
          </span>
          <span className="island-core" aria-hidden="true" />
        </button>

        <div className="speech no-drag">
          <span>{petStatusLabel}</span>
          <p>{latestLine}</p>
        </div>

        <div className="pet-controls no-drag">
          <button type="button" onClick={voiceAction} disabled={voiceStatus === 'connecting'} aria-label="Voice">
            {voiceStatus === 'connecting' ? <Loader2 className="spin" size={16} /> : voiceStatus === 'live' ? <Square size={16} /> : <Mic size={16} />}
          </button>
          <button type="button" onClick={screenAction} aria-label="Screen">
            <Monitor size={16} />
          </button>
          <button type="button" onClick={toggleExpanded} aria-label={expanded ? 'Collapse' : 'Expand'}>
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </section>

      {expanded ? (
        <section className="buddy-panel no-drag">
          <div className="panel-status">
            <span className={status?.api.hasOpenAiKey ? 'status-chip ok' : 'status-chip warn'}>
              <ShieldCheck size={13} />
              {status?.api.hasOpenAiKey ? 'Online' : 'Key'}
            </span>
            <span className="status-chip">
              <Brain size={13} />
              {activeJobCount}
            </span>
            <span className={approvals.length ? 'status-chip warn' : 'status-chip'}>
              <ShieldCheck size={13} />
              {approvals.length}
            </span>
            <span className={talking ? 'status-chip ok' : 'status-chip'}>
              <Mic size={13} />
              {micMode === 'push' ? 'PTT' : 'Open'}
            </span>
            {status?.wake ? (
              <span className={status.wake.engine.configured ? (status.wake.engine.running ? 'status-chip ok' : 'status-chip warn') : 'status-chip'} title={status.wake.words.join(', ')}>
                Wake
              </span>
            ) : null}
            <span className={screenLive && realtimeScreenContext ? 'status-chip ok' : 'status-chip'}>
              <Eye size={13} />
              {screenLive ? `Ctx ${screenSyncCount}` : 'View'}
            </span>
            <span className={screenPrivacy.mode === 'private' ? 'status-chip ok' : 'status-chip warn'}>
              {screenPrivacy.mode === 'private' ? 'Private' : 'Clear'}
            </span>
            {status?.actionPolicy?.dryRun ? <span className="status-chip warn">dry</span> : null}
            {status?.window ? (
              <span className={status.window.hotkeyRegistered ? 'status-chip ok' : 'status-chip warn'} title={status.window.hotkey}>
                Hotkey
              </span>
            ) : null}
            {status?.window?.captureHotkey ? (
              <span className={status.window.captureHotkeyRegistered ? 'status-chip ok' : 'status-chip warn'} title={status.window.captureHotkey}>
                Capture
              </span>
            ) : null}
            {status?.menuBar ? (
              <span className={status.menuBar.available ? 'status-chip ok' : 'status-chip warn'}>
                Menu
              </span>
            ) : null}
            {status?.notifications ? (
              <span className={status.notifications.enabled && status.notifications.supported ? 'status-chip ok' : 'status-chip warn'}>
                <Bell size={13} />
                Notify
              </span>
            ) : null}
            {status?.inbox ? (
              <span className={status.inbox.counts.open ? 'status-chip warn' : 'status-chip ok'}>
                <ClipboardList size={13} />
                inbox {status.inbox.counts.open}
              </span>
            ) : null}
            {status?.sessions ? (
              <span className={status.sessions.counts.active ? 'status-chip ok' : 'status-chip'}>
                <ListChecks size={13} />
                session {status.sessions.counts.active}
              </span>
            ) : null}
            {macContext?.frontmost.app ? <span className="status-chip">{macContext.frontmost.app}</span> : null}
            {configCheck ? (
              <span className={configCheck.overall === 'ready' ? 'status-chip ok' : configCheck.overall === 'blocked' ? 'status-chip bad' : 'status-chip warn'}>
                cfg {configCheck.counts.ready}/{configCheck.counts.total}
              </span>
            ) : null}
            {doctorReport ? (
              <span className={doctorReport.overall === 'ready' ? 'status-chip ok' : doctorReport.overall === 'blocked' ? 'status-chip bad' : 'status-chip warn'}>
                <Activity size={13} />
                doc {doctorReport.counts.ready}/{doctorReport.counts.total}
              </span>
            ) : null}
            {workBriefing ? (
              <span className={workBriefing.ok ? 'status-chip ok' : 'status-chip bad'}>
                <ListChecks size={13} />
                next {workBriefing.nextActions.length}
              </span>
            ) : null}
            {readiness ? (
              <span className={readiness.overall === 'ready' ? 'status-chip ok' : readiness.overall === 'blocked' ? 'status-chip bad' : 'status-chip warn'}>
                {readiness.counts.ready}/{readiness.counts.total}
              </span>
            ) : null}
          </div>

          {readiness ? (
            <div className={`readiness-strip ${readiness.overall}`}>
              <strong>{readiness.label}</strong>
              <span>{readiness.primaryIssue?.next || readiness.summary}</span>
            </div>
          ) : null}

          <div className="setup-actions">
            <button type="button" onClick={() => runSetupAction('prepare_env_file')} disabled={Boolean(setupBusy)}>
              {setupBusy === 'prepare_env_file' ? <Loader2 className="spin" size={14} /> : <Settings size={14} />}
              Key
            </button>
            <button type="button" onClick={runSetupNext} disabled={setupNextBusy || Boolean(setupBusy)}>
              {setupNextBusy ? <Loader2 className="spin" size={14} /> : <Settings size={14} />}
              Fix
            </button>
            <button type="button" onClick={() => runSetupAction('open_screen_settings')} disabled={Boolean(setupBusy)}>
              {setupBusy === 'open_screen_settings' ? <Loader2 className="spin" size={14} /> : <Monitor size={14} />}
              Screen
            </button>
            <button type="button" onClick={() => runSetupAction('open_accessibility_settings')} disabled={Boolean(setupBusy)}>
              {setupBusy === 'open_accessibility_settings' ? <Loader2 className="spin" size={14} /> : <ShieldCheck size={14} />}
              Access
            </button>
            <button type="button" onClick={() => runSetupAction('open_runtime_dir')} disabled={Boolean(setupBusy)}>
              {setupBusy === 'open_runtime_dir' ? <Loader2 className="spin" size={14} /> : <FolderOpen size={14} />}
              Files
            </button>
            <button type="button" onClick={() => runSetupAction('install_resident_agent')} disabled={Boolean(setupBusy)}>
              {setupBusy === 'install_resident_agent' ? <Loader2 className="spin" size={14} /> : <Power size={14} />}
              Login
            </button>
            <button type="button" onClick={runDoctorReport} disabled={doctorBusy}>
              {doctorBusy ? <Loader2 className="spin" size={14} /> : <Activity size={14} />}
              Doctor
            </button>
            <button type="button" onClick={runWorkBriefing} disabled={briefingBusy}>
              {briefingBusy ? <Loader2 className="spin" size={14} /> : <ListChecks size={14} />}
              Brief
            </button>
            <button type="button" onClick={runWorkProgress} disabled={progressBusy}>
              {progressBusy ? <Loader2 className="spin" size={14} /> : <Activity size={14} />}
              Progress
            </button>
            <button type="button" onClick={runWorkNext} disabled={workNextBusy}>
              {workNextBusy ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
              Next
            </button>
            <button type="button" onClick={triageInbox} disabled={triageInboxBusy}>
              {triageInboxBusy ? <Loader2 className="spin" size={14} /> : <ClipboardList size={14} />}
              Triage
            </button>
            <button type="button" onClick={processNextInbox} disabled={processingNextInbox || !inboxOpen.length}>
              {processingNextInbox ? <Loader2 className="spin" size={14} /> : <Send size={14} />}
              Do next
            </button>
          </div>

          <form className="quick-row" onSubmit={sendQuick}>
            <input value={quickInput} onChange={(event) => setQuickInput(event.target.value)} placeholder="Ask or task" />
            <button type="submit" disabled={busy || !quickInput.trim()} aria-label="Send">
              {busy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
            </button>
          </form>

          <div className="action-grid">
            <button type="button" onClick={voiceAction} disabled={voiceStatus === 'connecting'}>
              {voiceStatus === 'live' ? <Square size={15} /> : <Play size={15} />}
              Voice
            </button>
            <button type="button" onClick={() => setMicMode((current) => (current === 'push' ? 'open' : 'push'))}>
              <Mic size={15} />
              {micMode === 'push' ? 'PTT' : 'Open'}
            </button>
            <button type="button" onClick={screenAction}>
              <Eye size={15} />
              {screenLive ? 'Hide' : 'See'}
            </button>
            <button type="button" onClick={inspectAccessibilityTree} disabled={Boolean(accessibilityBusy)}>
              {accessibilityBusy === 'tree' ? <Loader2 className="spin" size={15} /> : <MousePointerClick size={15} />}
              UI
            </button>
            <button type="button" onClick={planUiAction} disabled={Boolean(accessibilityBusy)}>
              {accessibilityBusy === 'plan' ? <Loader2 className="spin" size={15} /> : <ListChecks size={15} />}
              Plan
            </button>
            <button type="button" onClick={previewAccessibilityAction} disabled={Boolean(accessibilityBusy) || !accessibilityTarget}>
              {accessibilityBusy === 'guard' ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
              Guard
            </button>
            <button type="button" onClick={requestAccessibilityAction} disabled={Boolean(accessibilityBusy) || !accessibilityTarget}>
              {accessibilityBusy === 'act' ? <Loader2 className="spin" size={15} /> : <MousePointerClick size={15} />}
              Act
            </button>
          </div>

          {accessibilitySummary ? <p className="ui-summary">{accessibilitySummary}</p> : null}

          {voiceStatus === 'live' && micMode === 'push' ? (
            <button
              type="button"
              className={isPushingToTalk ? 'hold-talk active' : 'hold-talk'}
              onMouseDown={() => setIsPushingToTalk(true)}
              onMouseUp={() => setIsPushingToTalk(false)}
              onMouseLeave={() => setIsPushingToTalk(false)}
              onTouchStart={() => setIsPushingToTalk(true)}
              onTouchEnd={() => setIsPushingToTalk(false)}
            >
              <Mic size={15} />
              Hold to talk
            </button>
          ) : null}

          {screenPreview ? (
            <button type="button" className="screen-thumb" onClick={() => captureFrame(true)}>
              <img src={screenPreview} alt="" />
            </button>
          ) : null}

          <label className={screenLive ? 'context-toggle' : 'context-toggle muted'}>
            <input
              type="checkbox"
              checked={realtimeScreenContext}
              disabled={!screenLive}
              onChange={(event) => setRealtimeScreenContext(event.target.checked)}
            />
            <span>Live context</span>
            <small>{lastScreenSyncAt ? timeLabel(lastScreenSyncAt) : 'idle'}</small>
          </label>

          <label className="context-toggle">
            <input
              type="checkbox"
              checked={screenPrivacy.mode === 'private'}
              onChange={(event) => updateScreenPrivacy(event.target.checked ? 'private' : 'clear')}
            />
            <span>Private screen</span>
            <small>
              {screenPrivacy.mode === 'private'
                ? `${screenPrivacy.maxWidth}px · blur ${screenPrivacy.blurPx}`
                : `${screenPrivacy.maxWidth}px · clear`}
            </small>
          </label>

          {macContext ? (
            <div className="mac-context">
              <div>
                <strong>{macContext.frontmost.app || 'No app'}</strong>
                <span>{macContext.frontmost.windowTitle || (macContext.frontmost.available ? 'Window' : 'Context unavailable')}</span>
              </div>
              <div>
                <strong>{macContext.clipboard.hasText ? `${macContext.clipboard.length} chars` : 'Empty'}</strong>
                <span>{macContext.clipboard.preview || 'Clipboard'}</span>
              </div>
              {macContext.browser.available ? (
                <div className="browser-context">
                  <strong>{macContext.browser.title || macContext.browser.app}</strong>
                  <span>{macContext.browser.url}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <form className="browser-workflow" onSubmit={runBrowserWorkflow}>
            <div className="browser-workflow-topline">
              <FileText size={14} />
              <select value={browserIntent} onChange={(event) => setBrowserIntent(event.target.value as BrowserWorkflowIntent)}>
                <option value="summarize">Summarize</option>
                <option value="extract_actions">Actions</option>
                <option value="draft">Draft</option>
                <option value="ask">Ask</option>
                <option value="act">Act</option>
                <option value="search">Search</option>
                <option value="compare">Compare</option>
                <option value="review_result">Review result</option>
                <option value="research">Research</option>
              </select>
              <select value={browserMode} onChange={(event) => setBrowserMode(event.target.value as BrowserWorkflowMode)}>
                <option value="quick">Quick</option>
                <option value="background">Deep</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </div>
            <div className="browser-workflow-entry">
              <input value={browserInstruction} onChange={(event) => setBrowserInstruction(event.target.value)} placeholder="Current page" />
              <button type="submit" disabled={browserBusy}>
                {browserBusy ? <Loader2 className="spin" size={15} /> : browserIntent === 'extract_actions' ? <ListChecks size={15} /> : browserIntent === 'act' ? <MousePointerClick size={15} /> : <Send size={15} />}
              </button>
            </div>
          </form>

          <form className="task-row" onSubmit={enqueueTask}>
            <div className="task-topline">
              <ClipboardList size={14} />
              <select value={taskMode} onChange={(event) => setTaskMode(event.target.value as JobMode)}>
                <option value="background">Deep</option>
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
            </div>
            <textarea value={taskInput} onChange={(event) => setTaskInput(event.target.value)} placeholder="Background task" />
            <button type="submit" disabled={!taskInput.trim()}>
              <Send size={15} />
              Queue
            </button>
          </form>

          <div className="mini-log">
            {activeSession ? (
              <article className="session-row">
                <div className="session-row-head">
                  <strong>{activeSession.title}</strong>
                  <button
                    type="button"
                    onClick={() => runSessionCheckIn(activeSession.id)}
                    disabled={checkingSessionId === activeSession.id}
                    aria-label="Session check-in"
                    title="Check in"
                  >
                    {checkingSessionId === activeSession.id ? <Loader2 className="spin" size={13} /> : <Activity size={13} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => endActiveSession(activeSession.id)}
                    disabled={endingSessionId === activeSession.id}
                    aria-label="End session"
                    title="End session"
                  >
                    {endingSessionId === activeSession.id ? <Loader2 className="spin" size={13} /> : <CircleCheck size={13} />}
                  </button>
                </div>
                <span>
                  {activeSession.events.length} event(s) · {timeLabel(activeSession.updatedAt)}
                </span>
                {sessionRecentEvents.length ? (
                  <div className="session-events">
                    {sessionRecentEvents.map((event) => (
                      <p key={event.id}>
                        {event.type}: {event.text}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p>{activeSession.goal}</p>
                )}
              </article>
            ) : null}
            {!activeSession && resumableSession ? (
              <article className="session-row">
                <div className="session-row-head resume-row-head">
                  <strong>{resumableSession.title}</strong>
                  <button
                    type="button"
                    onClick={() => resumeSession(resumableSession.id)}
                    disabled={resumingSessionId === resumableSession.id}
                    aria-label="Resume session"
                    title="Resume session"
                  >
                    {resumingSessionId === resumableSession.id ? <Loader2 className="spin" size={13} /> : <Play size={13} />}
                  </button>
                </div>
                <span>
                  {resumableSession.status} · {resumableSession.events.length} event(s) · {timeLabel(resumableSession.updatedAt)}
                </span>
                <p>{resumableSession.summary || resumableSession.goal}</p>
              </article>
            ) : null}
            {briefingActions.map((action) => (
              <article key={`briefing-${action.id}`} className={`briefing-row priority-${action.priority}`}>
                <strong>{action.label}</strong>
                <span>{action.summary}</span>
              </article>
            ))}
            {inboxOpen.slice(0, 2).map((item) => (
              <article key={`inbox-${item.id}`} className="inbox-row">
                <div className="inbox-row-head">
                  <strong>{item.title}</strong>
                  <button
                    type="button"
                    onClick={() => routeInboxItem(item.id)}
                    disabled={routingInboxId === item.id}
                    aria-label="Route inbox item"
                    title="Route"
                  >
                    {routingInboxId === item.id ? <Loader2 className="spin" size={13} /> : <Send size={13} />}
                  </button>
                  <button type="button" onClick={() => completeInboxItem(item.id)} aria-label="Complete inbox item" title="Complete">
                    <CircleCheck size={13} />
                  </button>
                </div>
                <span>
                  priority {item.priority} · {item.route?.label || item.source} · {timeLabel(item.updatedAt)}
                </span>
                {item.route?.jobId ? <span>job {item.route.jobId.slice(0, 8)}</span> : null}
                {item.body && item.body !== item.title ? <p>{item.body}</p> : null}
              </article>
            ))}
            {doctorIssues.map((check) => (
              <article key={`doctor-${check.id}`} className={`doctor-row ${check.status}`}>
                <strong>{check.label}</strong>
                <span>{check.next || check.summary}</span>
              </article>
            ))}
            {configIssues.map((item) => (
              <article key={item.id} className={`config-row ${item.status}`}>
                <strong>{item.label}</strong>
                <span>{item.next || item.summary}</span>
              </article>
            ))}
            {workflows.slice(0, 2).map((workflow) => (
              <article key={workflow.id} className={`workflow-row ${workflowTone(workflow.status)}`}>
                <div className="workflow-row-head">
                  <strong>{workflow.title}</strong>
                  <button
                    type="button"
                    onClick={() => copyWorkflowResult(workflow.id)}
                    disabled={copyingWorkflowId === workflow.id || !workflow.result.trim()}
                    aria-label="Copy workflow result"
                    title="Copy result"
                  >
                    {copyingWorkflowId === workflow.id ? <Loader2 className="spin" size={13} /> : <Clipboard size={13} />}
                  </button>
                </div>
                <span>
                  {workflow.kind} · {workflow.status} · {workflow.mode || 'quick'} · {timeLabel(workflow.updatedAt)}
                </span>
                {compactWorkflowText(workflow) ? <p>{compactWorkflowText(workflow)}</p> : null}
              </article>
            ))}
            {runtimeEvents.slice(-3).reverse().map((event) => (
              <article key={`${event.ts}-${event.type}`} className="event-row">
                <strong>{event.type}</strong>
                <span>{event.ts ? new Date(event.ts).toLocaleTimeString() : 'runtime'}</span>
              </article>
            ))}
            {approvals.slice(0, 2).map((approval) => (
              <article key={approval.id} className="approval-row">
                <strong>{approval.summary}</strong>
                <span>
                  level {approval.riskLevel} · {approval.action}
                </span>
                <div>
                  <button type="button" onClick={() => approveAction(approval.id)}>
                    Approve
                  </button>
                  <button type="button" onClick={() => rejectAction(approval.id)}>
                    Reject
                  </button>
                </div>
              </article>
            ))}
            {jobs.slice(0, 3).map((job) => (
              <article key={job.id} className={`mini-job ${jobTone(job.status)}`}>
                <div className="mini-job-head">
                  <strong>{job.title}</strong>
                  {job.status === 'queued' || job.status === 'running' ? (
                    <button type="button" onClick={() => cancelJob(job.id)} aria-label="Cancel job">
                      <XCircle size={13} />
                    </button>
                  ) : null}
                </div>
                <span>
                  {job.mode} · {job.status} · {job.pid ? `pid ${job.pid} · ` : ''}
                  {timeLabel(job.updatedAt)}
                </span>
                {compactJobText(job) ? <p>{compactJobText(job)}</p> : null}
              </article>
            ))}
            {!activeSession && !jobs.length && !approvals.length && !configIssues.length && !doctorIssues.length && !workflows.length && !briefingActions.length && !inboxOpen.length ? <p>No background jobs.</p> : null}
          </div>

          {lastError ? <p className="error-line">{lastError}</p> : null}
        </section>
      ) : null}
    </main>
  )
}

export default App
