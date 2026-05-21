import type { Session } from '@/stores/hermes/chat'

function normalizeProfile(profile?: string | null): string {
  return profile || 'default'
}

function normalizeSpace(spaceId?: string | null): string | null {
  return spaceId || null
}

function hasHistory(session: Session): boolean {
  return (session.messageCount || 0) > 0 || (session.messages?.length || 0) > 0 || Boolean(session.title?.trim())
}

export function filterSessionsForProfileWithFallback(
  sessions: Session[],
  nextSessionProfile?: string | null,
  nextSessionSpaceId?: string | null,
): Session[] {
  const targetProfile = normalizeProfile(nextSessionProfile)
  const targetSpaceId = normalizeSpace(nextSessionSpaceId)
  const profileMatching = sessions.filter(
    (session) => normalizeProfile(session.profile) === targetProfile,
  )

  if (targetSpaceId) {
    const exact = profileMatching.filter(
      (session) => normalizeSpace(session.spaceId) === targetSpaceId,
    )
    const legacy = profileMatching.filter(
      (session) => normalizeSpace(session.spaceId) === null && hasHistory(session),
    )
    if (exact.length > 0) return [...exact, ...legacy]
    if (legacy.length > 0) return legacy
  }

  return profileMatching.length > 0 ? profileMatching : sessions
}
