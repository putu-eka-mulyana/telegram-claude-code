import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  MultiProjectState,
  defaultSessionId,
  encodeProjectCallback,
  encodeRefreshCallback,
  encodeSessionCallback,
  encodeStartCallback,
  matchProjectByDir,
  parseSelectionCallback,
} from '../multi-project'

const PROJECTS_FOR_DIR = [
  { id: 'alpha', label: 'Alpha', workingDirectory: '/work/alpha', enabled: true as const },
  { id: 'beta', label: 'Beta', workingDirectory: '/work/beta', enabled: true as const },
  { id: 'nested', label: 'Nested', workingDirectory: '/work/alpha/packages/api', enabled: true as const },
]

function fixture(now: () => number = () => 1_000): MultiProjectState {
  const root = mkdtempSync(join(tmpdir(), 'telegram-router-'))
  writeFileSync(
    join(root, 'projects.json'),
    JSON.stringify({
      projects: {
        billing: {
          label: 'Billing API',
          workingDirectory: '/work/billing',
          enabled: true,
          launchCommand: ['claude', '--channels', 'plugin:forked-telegram@custom-marketplace'],
        },
        tools: {
          label: 'Internal Tools',
          workingDirectory: '/work/tools',
          enabled: true,
        },
        hidden: {
          label: 'Hidden',
          workingDirectory: '/work/hidden',
          enabled: false,
          launchCommand: ['do-not-run'],
        },
      },
    }),
  )
  return new MultiProjectState(root, now)
}

describe('MultiProjectState', () => {
  test('lists enabled projects and binds a chat to a live session', () => {
    const state = fixture()
    state.registerSession({
      id: 'terminal-1',
      projectId: 'billing',
      label: 'terminal-1',
      origin: 'manual',
      pid: 10,
    })

    expect(state.listProjects().map(project => project.id)).toEqual(['billing', 'tools'])
    state.bindChat('8123', 'billing', 'terminal-1')
    expect(state.resolveBinding('8123')?.session.id).toBe('terminal-1')
  })

  test('rejects bindings to sessions outside the enabled registry', () => {
    const state = fixture()
    state.registerSession({
      id: 'hidden-1',
      projectId: 'hidden',
      label: 'hidden-1',
      origin: 'manual',
      pid: 10,
    })

    expect(() => state.bindChat('8123', 'hidden', 'hidden-1')).toThrow()
  })

  test('does not resolve a binding after the session heartbeat expires', () => {
    let now = 1_000
    const state = fixture(() => now)
    state.registerSession({
      id: 'terminal-1',
      projectId: 'billing',
      label: 'terminal-1',
      origin: 'manual',
      pid: 10,
    })
    state.bindChat('8123', 'billing', 'terminal-1')

    now += 31_000
    expect(state.resolveBinding('8123')).toBeUndefined()
  })

  test('keeps multiple connector heartbeats independently visible', () => {
    const state = fixture()
    state.registerSession({ id: 'terminal-1', projectId: 'billing', label: 'terminal-1', origin: 'manual', pid: 10 })
    state.registerSession({ id: 'terminal-2', projectId: 'billing', label: 'terminal-2', origin: 'manual', pid: 11 })
    state.heartbeat('billing', 'terminal-1')
    state.heartbeat('billing', 'terminal-2')

    expect(state.listSessions('billing').map(session => session.id)).toEqual([
      'terminal-1',
      'terminal-2',
    ])
  })

  test('allows the same session id in different projects', () => {
    const state = fixture()
    state.registerSession({ id: 'terminal-1', projectId: 'billing', label: 'terminal-1', origin: 'manual', pid: 10 })
    state.registerSession({ id: 'terminal-1', projectId: 'tools', label: 'terminal-1', origin: 'manual', pid: 11 })

    expect(state.listSessions('billing').map(session => session.id)).toEqual(['terminal-1'])
    expect(state.listSessions('tools').map(session => session.id)).toEqual(['terminal-1'])
  })

  test('delivers queued notifications only to the addressed session', () => {
    const state = fixture()
    state.enqueue('billing', 'terminal-1', { content: 'cek invoice', meta: { chat_id: '8123' } })

    expect(state.drain('billing', 'terminal-2')).toEqual([])
    expect(state.drain('billing', 'terminal-1')).toEqual([
      { content: 'cek invoice', meta: { chat_id: '8123' } },
    ])
    expect(state.drain('billing', 'terminal-1')).toEqual([])
  })

  test('returns an operator-defined launch spec only for an enabled project', () => {
    const state = fixture()

    expect(state.getLaunchSpec('billing')).toEqual({
      command: ['claude', '--channels', 'plugin:forked-telegram@custom-marketplace'],
      workingDirectory: '/work/billing',
    })
    expect(state.getLaunchSpec('hidden')).toBeUndefined()
    expect(state.getLaunchSpec('../billing')).toBeUndefined()
  })

  test('keeps one live poller owner and replaces a stale owner', () => {
    const livePids = new Set([10])
    const root = mkdtempSync(join(tmpdir(), 'telegram-router-'))
    const state = new MultiProjectState(root, () => 1_000, pid => livePids.has(pid))

    expect(state.claimPoller(10)).toBe('router')
    expect(state.claimPoller(20)).toBe('connector')

    livePids.delete(10)
    livePids.add(20)
    expect(state.claimPoller(20)).toBe('router')
    state.releasePoller(20)
    expect(state.claimPoller(30)).toBe('router')
  })

  test('caps managed sessions per project at the configured or default limit', () => {
    const root = mkdtempSync(join(tmpdir(), 'telegram-router-'))
    writeFileSync(
      join(root, 'projects.json'),
      JSON.stringify({
        projects: {
          capped: { label: 'Capped', workingDirectory: '/work/capped', enabled: true, maxManagedSessions: 1 },
          free: { label: 'Free', workingDirectory: '/work/free', enabled: true },
        },
      }),
    )
    const state = new MultiProjectState(root, () => 1_000)

    expect(state.managedSessionLimit('capped')).toBe(1)
    expect(state.managedSessionLimit('free')).toBe(3) // default
    expect(state.canStartManagedSession('capped')).toBe(true)

    state.registerSession({ id: 'managed-1', projectId: 'capped', label: 'managed-1', origin: 'managed', pid: 10 })
    expect(state.managedSessionCount('capped')).toBe(1)
    expect(state.canStartManagedSession('capped')).toBe(false)

    // Manual sessions do not count toward the managed cap.
    state.registerSession({ id: 'terminal-1', projectId: 'free', label: 'terminal-1', origin: 'manual', pid: 11 })
    expect(state.managedSessionCount('free')).toBe(0)
    expect(state.canStartManagedSession('free')).toBe(true)
  })

  test('labels a response only after the chat target moves to another session', () => {
    const state = fixture()
    state.registerSession({ id: 'terminal-1', projectId: 'billing', label: 'terminal-1', origin: 'manual', pid: 10 })
    state.registerSession({ id: 'terminal-2', projectId: 'billing', label: 'terminal-2', origin: 'manual', pid: 11 })
    state.bindChat('8123', 'billing', 'terminal-2')

    // No binding for an unknown chat → no label.
    expect(state.shouldLabelResponse('9999', 'billing', 'terminal-1')).toBe(false)
    // The currently-bound session answering → no label.
    expect(state.shouldLabelResponse('8123', 'billing', 'terminal-2')).toBe(false)
    // A different session answering the same chat → label it.
    expect(state.shouldLabelResponse('8123', 'billing', 'terminal-1')).toBe(true)
  })

  test('routes a permission answer back to the originating session', () => {
    const state = fixture()
    state.bindPermission('abcde', 'billing', 'terminal-1')

    expect(state.resolvePermission('abcde')).toEqual({ projectId: 'billing', sessionId: 'terminal-1' })
    state.enqueuePermission('billing', 'terminal-1', { request_id: 'abcde', behavior: 'allow' })
    expect(state.drainPermissions('billing', 'terminal-2')).toEqual([])
    expect(state.drainPermissions('billing', 'terminal-1')).toEqual([
      { request_id: 'abcde', behavior: 'allow' },
    ])
    state.clearPermission('abcde')
    expect(state.resolvePermission('abcde')).toBeUndefined()
  })
})

describe('matchProjectByDir (directory-based auto-detection)', () => {
  test('matches the exact working directory', () => {
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/alpha')).toBe('alpha')
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/beta')).toBe('beta')
  })

  test('matches a directory nested under a project', () => {
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/beta/src/handlers')).toBe('beta')
  })

  test('prefers the most specific (longest) match for nested projects', () => {
    // /work/alpha/packages/api is inside /work/alpha, but the nested project wins.
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/alpha/packages/api')).toBe('nested')
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/alpha/packages/api/lib')).toBe('nested')
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/alpha/web')).toBe('alpha')
  })

  test('returns undefined for an unrelated dir or a non-absolute / unexpanded value', () => {
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/gamma')).toBeUndefined()
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '${CLAUDE_PROJECT_DIR}')).toBeUndefined()
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '')).toBeUndefined()
    // A sibling whose name merely shares a prefix must not match.
    expect(matchProjectByDir(PROJECTS_FOR_DIR, '/work/alpha-staging')).toBeUndefined()
  })
})

describe('selection callbacks', () => {
  test('labels default session ids by their origin', () => {
    expect(defaultSessionId('manual', 12)).toBe('manual-12')
    expect(defaultSessionId('managed', 12)).toBe('managed-12')
  })

  test('encodes and parses project and session callbacks', () => {
    expect(encodeProjectCallback('billing')).toBe('project:billing')
    expect(encodeSessionCallback('billing', 'terminal-1')).toBe('session:billing:terminal-1')
    expect(encodeStartCallback('billing')).toBe('start:billing')
    expect(encodeRefreshCallback('billing')).toBe('refresh:billing')
    expect(parseSelectionCallback('project:billing')).toEqual({
      kind: 'project',
      projectId: 'billing',
    })
    expect(parseSelectionCallback('session:billing:terminal-1')).toEqual({
      kind: 'session',
      projectId: 'billing',
      sessionId: 'terminal-1',
    })
    expect(parseSelectionCallback('start:billing')).toEqual({
      kind: 'start',
      projectId: 'billing',
    })
    expect(parseSelectionCallback('refresh:billing')).toEqual({
      kind: 'refresh',
      projectId: 'billing',
    })
  })

  test('rejects invalid callback identifiers', () => {
    expect(parseSelectionCallback('session:../billing:terminal-1')).toBeUndefined()
    expect(parseSelectionCallback('session:billing:../../escape')).toBeUndefined()
    expect(() => encodeProjectCallback('../billing')).toThrow()
  })
})
