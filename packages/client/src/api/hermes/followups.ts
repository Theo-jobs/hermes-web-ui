import { request } from '@/api/client'

export interface FollowupSuggestionRequest {
  sessionId?: string
  profile?: string
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>
}

export interface FollowupSuggestionResponse {
  suggestions: string[]
  source: 'model' | 'fallback'
}

export async function generateFollowupSuggestions(payload: FollowupSuggestionRequest): Promise<FollowupSuggestionResponse> {
  return request<FollowupSuggestionResponse>('/api/hermes/followups', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
