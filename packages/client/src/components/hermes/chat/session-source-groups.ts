export type SessionRunSourceGroupKey = 'cli' | 'api_server' | 'other'

export interface SessionRunSourceGroup<T> {
  key: SessionRunSourceGroupKey
  sessions: T[]
}

const SOURCE_GROUP_ORDER: SessionRunSourceGroupKey[] = ['cli', 'api_server', 'other']

export function getSessionRunSourceGroupKey(source?: string | null): SessionRunSourceGroupKey {
  if (source === 'cli' || source === 'api_server') return source
  return 'other'
}

export function groupSessionsByRunSource<T extends { source?: string | null }>(
  sessions: T[],
): SessionRunSourceGroup<T>[] {
  const groups: Record<SessionRunSourceGroupKey, T[]> = {
    cli: [],
    api_server: [],
    other: [],
  }

  for (const session of sessions) {
    groups[getSessionRunSourceGroupKey(session.source)].push(session)
  }

  return SOURCE_GROUP_ORDER
    .map(key => ({ key, sessions: groups[key] }))
    .filter(group => group.sessions.length > 0)
}
