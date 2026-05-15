import type { Session } from '@/stores/hermes/chat'

function normalizeProfile(profile?: string | null): string {
  return profile || 'default'
}

export function filterSessionsForProfileWithFallback(
  sessions: Session[],
  nextSessionProfile?: string | null,
): Session[] {
  const targetProfile = normalizeProfile(nextSessionProfile)
  const matching = sessions.filter(
    (session) => normalizeProfile(session.profile) === targetProfile,
  )
  return matching.length > 0 ? matching : sessions
}
