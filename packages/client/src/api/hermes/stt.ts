import { getApiKey, getBaseUrlValue } from '@/api/client'

export interface SttResponse {
  success: boolean
  transcript: string
  provider?: string
  error?: string
}

export async function transcribeAudio(file: Blob, filename = 'recording.webm'): Promise<SttResponse> {
  const formData = new FormData()
  formData.append('audio', file, filename)

  const headers: Record<string, string> = {}
  const apiKey = getApiKey()
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const res = await fetch(`${getBaseUrlValue()}/api/hermes/stt`, {
    method: 'POST',
    headers,
    body: formData,
  })

  const data = await res.json().catch(() => null) as SttResponse | null
  if (!res.ok) {
    throw new Error(data?.error || `STT failed (${res.status})`)
  }
  if (!data?.success) {
    throw new Error(data?.error || 'STT failed')
  }
  return data
}
