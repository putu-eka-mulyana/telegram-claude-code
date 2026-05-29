import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { randomUUID } from 'crypto'
import { isAbsolute, join } from 'path'

const ID_PATTERN = /^[A-Za-z0-9_-]+$/
const SESSION_TIMEOUT_MS = 30_000
// Cap on bot-launched ("managed") sessions per project. Manual terminal
// sessions are not counted — only the ones the Start New Session button spawns,
// since those are the ones an unbounded Telegram tap could multiply.
const DEFAULT_MAX_MANAGED_SESSIONS = 3

export type Project = {
  id: string
  label: string
  workingDirectory: string
  enabled: boolean
  launchCommand?: string[]
  maxManagedSessions?: number
}

export type RegisteredSession = {
  id: string
  projectId: string
  label: string
  origin: 'manual' | 'managed'
  pid: number
  lastSeen: number
}

export type RoutedNotification = {
  content: string
  meta: Record<string, string | undefined>
}

type StoredProjects = {
  projects?: Record<string, Omit<Project, 'id'>>
}

type ChatBinding = {
  projectId: string
  sessionId: string
  updatedAt: number
}

type StoredBindings = Record<string, ChatBinding>

type PollerOwner = {
  pid: number
  claimedAt: number
}

export type Selection =
  | { kind: 'project'; projectId: string }
  | { kind: 'session'; projectId: string; sessionId: string }
  | { kind: 'start'; projectId: string }
  | { kind: 'refresh'; projectId: string }

export type RoutedPermission = {
  request_id: string
  behavior: 'allow' | 'deny'
}

function validId(id: string): boolean {
  return ID_PATTERN.test(id)
}

// Read + validate the project registry without any of the side effects the
// MultiProjectState constructor has (it mkdir's the router/ tree). Used both by
// listProjects() and by directory-based auto-detection at startup.
export function loadProjects(stateDir: string): Project[] {
  const stored = readJson<StoredProjects>(join(stateDir, 'projects.json'), {})
  return Object.entries(stored.projects ?? {})
    .filter(([id, project]) => validId(id) && project.enabled === true)
    .filter(([, project]) => (
      typeof project.label === 'string'
      && typeof project.workingDirectory === 'string'
      && isAbsolute(project.workingDirectory)
    ))
    .map(([id, project]) => ({ ...project, id, enabled: true }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

// Pick the registered project whose workingDirectory contains `dir` (exact, or
// `dir` nested under it). The most specific (longest) match wins, so a project
// nested inside another routes correctly. Non-absolute input (e.g. an
// unexpanded "${CLAUDE_PROJECT_DIR}") matches nothing.
export function matchProjectByDir(projects: Project[], dir: string): string | undefined {
  if (typeof dir !== 'string' || !isAbsolute(dir)) return undefined
  const matches = projects.filter(project => {
    const base = project.workingDirectory.replace(/\/+$/, '')
    return dir === base || dir.startsWith(base + '/')
  })
  if (matches.length === 0) return undefined
  matches.sort((a, b) => b.workingDirectory.length - a.workingDirectory.length)
  return matches[0]!.id
}

function requireId(id: string, name: string): void {
  if (!validId(id)) throw new Error(`Invalid ${name}`)
}

function sessionKey(projectId: string, sessionId: string): string {
  requireId(projectId, 'project id')
  requireId(sessionId, 'session id')
  return `${projectId}--${sessionId}`
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, path)
}

export function defaultSessionId(origin: 'manual' | 'managed', pid: number): string {
  return `${origin}-${pid}`
}

export function encodeProjectCallback(projectId: string): string {
  requireId(projectId, 'project id')
  return `project:${projectId}`
}

export function encodeSessionCallback(projectId: string, sessionId: string): string {
  requireId(projectId, 'project id')
  requireId(sessionId, 'session id')
  return `session:${projectId}:${sessionId}`
}

export function encodeStartCallback(projectId: string): string {
  requireId(projectId, 'project id')
  return `start:${projectId}`
}

export function encodeRefreshCallback(projectId: string): string {
  requireId(projectId, 'project id')
  return `refresh:${projectId}`
}

export function parseSelectionCallback(value: string): Selection | undefined {
  const parts = value.split(':')
  if (parts[0] === 'project' && parts.length === 2 && validId(parts[1]!)) {
    return { kind: 'project', projectId: parts[1]! }
  }
  if (
    parts[0] === 'session'
    && parts.length === 3
    && validId(parts[1]!)
    && validId(parts[2]!)
  ) {
    return { kind: 'session', projectId: parts[1]!, sessionId: parts[2]! }
  }
  if (parts[0] === 'start' && parts.length === 2 && validId(parts[1]!)) {
    return { kind: 'start', projectId: parts[1]! }
  }
  if (parts[0] === 'refresh' && parts.length === 2 && validId(parts[1]!)) {
    return { kind: 'refresh', projectId: parts[1]! }
  }
  return undefined
}

export class MultiProjectState {
  private readonly routerDir: string
  private readonly sessionsDir: string
  private readonly bindingsFile: string
  private readonly queuesDir: string
  private readonly permissionRoutesDir: string
  private readonly permissionQueuesDir: string
  private readonly pollerFile: string

  constructor(
    private readonly stateDir: string,
    private readonly now: () => number = () => Date.now(),
    private readonly isProcessAlive: (pid: number) => boolean = pid => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    },
  ) {
    this.routerDir = join(this.stateDir, 'router')
    this.sessionsDir = join(this.routerDir, 'sessions')
    this.bindingsFile = join(this.routerDir, 'bindings.json')
    this.queuesDir = join(this.routerDir, 'queues')
    this.permissionRoutesDir = join(this.routerDir, 'permission-routes')
    this.permissionQueuesDir = join(this.routerDir, 'permission-queues')
    this.pollerFile = join(this.routerDir, 'poller.json')
    mkdirSync(this.routerDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.queuesDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.permissionRoutesDir, { recursive: true, mode: 0o700 })
    mkdirSync(this.permissionQueuesDir, { recursive: true, mode: 0o700 })
  }

  listProjects(): Project[] {
    return loadProjects(this.stateDir)
  }

  registerSession(session: Omit<RegisteredSession, 'lastSeen'>): void {
    requireId(session.id, 'session id')
    requireId(session.projectId, 'project id')
    atomicWriteJson(join(this.sessionsDir, `${sessionKey(session.projectId, session.id)}.json`), {
      ...session,
      lastSeen: this.now(),
    })
  }

  heartbeat(projectId: string, sessionId: string): void {
    const path = join(this.sessionsDir, `${sessionKey(projectId, sessionId)}.json`)
    const session = readJson<RegisteredSession | undefined>(path, undefined)
    if (!session) return
    session.lastSeen = this.now()
    atomicWriteJson(path, session)
  }

  listSessions(projectId: string): RegisteredSession[] {
    requireId(projectId, 'project id')
    const sessions = readdirSync(this.sessionsDir)
      .filter(file => file.endsWith('.json'))
      .flatMap(file => {
        const session = readJson<RegisteredSession | undefined>(join(this.sessionsDir, file), undefined)
        return session ? [session] : []
      })
    return sessions
      .filter(session => session.projectId === projectId && this.isLive(session))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  bindChat(chatId: string, projectId: string, sessionId: string): void {
    requireId(projectId, 'project id')
    requireId(sessionId, 'session id')
    const project = this.listProjects().find(candidate => candidate.id === projectId)
    const session = this.listSessions(projectId).find(candidate => candidate.id === sessionId)
    if (!project || !session) throw new Error('Project or session is not available')
    const bindings = readJson<StoredBindings>(this.bindingsFile, {})
    bindings[chatId] = { projectId, sessionId, updatedAt: this.now() }
    atomicWriteJson(this.bindingsFile, bindings)
  }

  resolveBinding(chatId: string): { project: Project; session: RegisteredSession } | undefined {
    const bindings = readJson<StoredBindings>(this.bindingsFile, {})
    const binding = bindings[chatId]
    if (!binding) return undefined
    const project = this.listProjects().find(candidate => candidate.id === binding.projectId)
    const session = this.listSessions(binding.projectId)
      .find(candidate => candidate.id === binding.sessionId)
    return project && session ? { project, session } : undefined
  }

  enqueue(projectId: string, sessionId: string, notification: RoutedNotification): void {
    const queueDir = join(this.queuesDir, sessionKey(projectId, sessionId))
    mkdirSync(queueDir, { recursive: true, mode: 0o700 })
    atomicWriteJson(join(queueDir, `${this.now()}-${randomUUID()}.json`), notification)
  }

  drain(projectId: string, sessionId: string): RoutedNotification[] {
    const queueDir = join(this.queuesDir, sessionKey(projectId, sessionId))
    let files: string[]
    try {
      files = readdirSync(queueDir).filter(file => file.endsWith('.json')).sort()
    } catch {
      return []
    }
    return files.flatMap(file => {
      const path = join(queueDir, file)
      const item = readJson<RoutedNotification | undefined>(path, undefined)
      rmSync(path, { force: true })
      return item ? [item] : []
    })
  }

  bindPermission(requestId: string, projectId: string, sessionId: string): void {
    requireId(requestId, 'request id')
    sessionKey(projectId, sessionId)
    atomicWriteJson(join(this.permissionRoutesDir, `${requestId}.json`), { projectId, sessionId })
  }

  resolvePermission(requestId: string): { projectId: string; sessionId: string } | undefined {
    if (!validId(requestId)) return undefined
    const route = readJson<{ projectId?: string; sessionId?: string }>(
      join(this.permissionRoutesDir, `${requestId}.json`),
      {},
    )
    return route.projectId && route.sessionId
      ? { projectId: route.projectId, sessionId: route.sessionId }
      : undefined
  }

  clearPermission(requestId: string): void {
    if (!validId(requestId)) return
    rmSync(join(this.permissionRoutesDir, `${requestId}.json`), { force: true })
  }

  enqueuePermission(projectId: string, sessionId: string, permission: RoutedPermission): void {
    requireId(permission.request_id, 'request id')
    const queueDir = join(this.permissionQueuesDir, sessionKey(projectId, sessionId))
    mkdirSync(queueDir, { recursive: true, mode: 0o700 })
    atomicWriteJson(join(queueDir, `${this.now()}-${randomUUID()}.json`), permission)
  }

  drainPermissions(projectId: string, sessionId: string): RoutedPermission[] {
    const queueDir = join(this.permissionQueuesDir, sessionKey(projectId, sessionId))
    let files: string[]
    try {
      files = readdirSync(queueDir).filter(file => file.endsWith('.json')).sort()
    } catch {
      return []
    }
    return files.flatMap(file => {
      const path = join(queueDir, file)
      const item = readJson<RoutedPermission | undefined>(path, undefined)
      rmSync(path, { force: true })
      return item ? [item] : []
    })
  }

  // Number of live sessions for a project that were spawned by the bot.
  managedSessionCount(projectId: string): number {
    return this.listSessions(projectId).filter(session => session.origin === 'managed').length
  }

  // Configured cap (or default). A non-negative integer in projects.json wins;
  // anything else falls back to the default. 0 disables bot-launched sessions.
  managedSessionLimit(projectId: string): number {
    const project = this.listProjects().find(candidate => candidate.id === projectId)
    const configured = project?.maxManagedSessions
    return typeof configured === 'number' && Number.isInteger(configured) && configured >= 0
      ? configured
      : DEFAULT_MAX_MANAGED_SESSIONS
  }

  canStartManagedSession(projectId: string): boolean {
    return this.managedSessionCount(projectId) < this.managedSessionLimit(projectId)
  }

  // True when this chat's stored binding points at a different session/project
  // than the one answering — i.e. the user switched targets, so the reply
  // should be labeled with its origin to avoid confusion.
  shouldLabelResponse(chatId: string, projectId: string, sessionId: string): boolean {
    const bindings = readJson<StoredBindings>(this.bindingsFile, {})
    const binding = bindings[chatId]
    if (!binding) return false
    return binding.projectId !== projectId || binding.sessionId !== sessionId
  }

  getLaunchSpec(projectId: string): { command: string[]; workingDirectory: string } | undefined {
    if (!validId(projectId)) return undefined
    const project = this.listProjects().find(candidate => candidate.id === projectId)
    if (!project || !Array.isArray(project.launchCommand) || project.launchCommand.length === 0) {
      return undefined
    }
    if (!project.launchCommand.every(part => typeof part === 'string' && part.length > 0)) {
      return undefined
    }
    return { command: [...project.launchCommand], workingDirectory: project.workingDirectory }
  }

  claimPoller(pid: number): 'router' | 'connector' {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(
          this.pollerFile,
          `${JSON.stringify({ pid, claimedAt: this.now() }, null, 2)}\n`,
          { flag: 'wx', mode: 0o600 },
        )
        return 'router'
      } catch {
        const owner = readJson<PollerOwner | undefined>(this.pollerFile, undefined)
        if (owner?.pid === pid) return 'router'
        if (owner && this.isProcessAlive(owner.pid)) return 'connector'
        rmSync(this.pollerFile, { force: true })
      }
    }
    return 'connector'
  }

  releasePoller(pid: number): void {
    const owner = readJson<PollerOwner | undefined>(this.pollerFile, undefined)
    if (owner?.pid === pid) rmSync(this.pollerFile, { force: true })
  }

  private isLive(session: RegisteredSession): boolean {
    return this.now() - session.lastSeen <= SESSION_TIMEOUT_MS
  }
}
