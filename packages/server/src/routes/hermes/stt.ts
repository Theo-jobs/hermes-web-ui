import Router from '@koa/router'
import { saveSttUpload, transcribeWithHermes, type SttUpload } from '../../services/hermes/stt'

export const sttRoutes = new Router()

sttRoutes.post('/api/hermes/stt', async (ctx) => {
  const contentType = ctx.get('content-type') || ''
  if (!contentType.startsWith('multipart/form-data')) {
    ctx.status = 400
    ctx.body = { success: false, transcript: '', error: 'Expected multipart/form-data' }
    return
  }

  const boundaryValue = contentType.split('boundary=')[1]
  if (!boundaryValue) {
    ctx.status = 400
    ctx.body = { success: false, transcript: '', error: 'Missing multipart boundary' }
    return
  }

  const chunks: Buffer[] = []
  for await (const chunk of ctx.req) chunks.push(chunk)

  const upload = extractFirstAudioUpload(Buffer.concat(chunks), Buffer.from(`--${boundaryValue}`))
  if (!upload) {
    ctx.status = 400
    ctx.body = { success: false, transcript: '', error: 'No audio file found' }
    return
  }

  try {
    const savedPath = await saveSttUpload(upload)
    const result = await transcribeWithHermes(savedPath)
    ctx.status = result.success ? 200 : 502
    ctx.body = result
  } catch (err: any) {
    ctx.status = Number(err?.status) || 500
    ctx.body = {
      success: false,
      transcript: '',
      error: err?.message || 'Transcription failed',
    }
  }
})

function extractFirstAudioUpload(raw: Buffer, boundary: Buffer): SttUpload | null {
  for (const part of splitMultipart(raw, boundary)) {
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd === -1) continue

    const header = part.subarray(0, headerEnd).toString('utf-8')
    const filename = readFilename(header)
    if (!filename) continue

    return {
      filename,
      data: part.subarray(headerEnd + 4, part.length - 2),
    }
  }
  return null
}

function readFilename(header: string): string | null {
  const filenameStarMatch = header.match(/filename\*=UTF-8''([^\r\n;]+)/i)
  if (filenameStarMatch) return decodeURIComponent(filenameStarMatch[1])
  const filenameMatch = header.match(/filename="([^"]+)"/)
  return filenameMatch?.[1] || null
}

function splitMultipart(raw: Buffer, boundary: Buffer): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  while (true) {
    const idx = raw.indexOf(boundary, start)
    if (idx === -1) break
    if (start > 0) parts.push(raw.subarray(start + 2, idx))
    start = idx + boundary.length
  }
  return parts
}
