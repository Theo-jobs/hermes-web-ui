import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveSttUploadMock = vi.fn(async () => '/tmp/hermes-stt.webm')
const transcribeWithHermesMock = vi.fn(async () => ({
  success: true,
  transcript: 'hello world',
  provider: 'local',
}))

vi.mock('../../packages/server/src/services/hermes/stt', () => ({
  saveSttUpload: saveSttUploadMock,
  transcribeWithHermes: transcribeWithHermesMock,
}))

function createReq(buffer: Buffer) {
  return {
    async *[Symbol.asyncIterator]() {
      yield buffer
    },
  }
}

function multipartBody(boundary: string, filename?: string, payload = 'audio-bytes') {
  const disposition = filename
    ? `Content-Disposition: form-data; name="audio"; filename="${filename}"`
    : 'Content-Disposition: form-data; name="audio"'
  return Buffer.from(
    [
      `--${boundary}`,
      disposition,
      'Content-Type: audio/webm',
      '',
      payload,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  )
}

async function loadSttRouteLayer() {
  const { sttRoutes } = await import('../../packages/server/src/routes/hermes/stt')
  return sttRoutes.stack.find((entry: any) => entry.path === '/api/hermes/stt')
}

describe('stt routes', () => {
  beforeEach(() => {
    vi.resetModules()
    saveSttUploadMock.mockClear()
    transcribeWithHermesMock.mockClear()
    saveSttUploadMock.mockResolvedValue('/tmp/hermes-stt.webm')
    transcribeWithHermesMock.mockResolvedValue({
      success: true,
      transcript: 'hello world',
      provider: 'local',
    })
  })

  it('registers the protected STT route', async () => {
    const { sttRoutes } = await import('../../packages/server/src/routes/hermes/stt')
    const paths = sttRoutes.stack.map((entry: any) => entry.path)

    expect(paths).toEqual(expect.arrayContaining(['/api/hermes/stt']))
  })

  it('rejects non-multipart requests', async () => {
    const layer = await loadSttRouteLayer()
    const ctx: any = {
      get: () => 'application/json',
      status: 200,
      body: null,
    }

    await layer.stack[0](ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ success: false, transcript: '', error: 'Expected multipart/form-data' })
    expect(saveSttUploadMock).not.toHaveBeenCalled()
  })

  it('rejects multipart requests without a boundary', async () => {
    const layer = await loadSttRouteLayer()
    const ctx: any = {
      get: () => 'multipart/form-data',
      status: 200,
      body: null,
    }

    await layer.stack[0](ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ success: false, transcript: '', error: 'Missing multipart boundary' })
    expect(saveSttUploadMock).not.toHaveBeenCalled()
  })

  it('rejects multipart requests without an audio file', async () => {
    const layer = await loadSttRouteLayer()
    const boundary = '----hermes-test-boundary'
    const ctx: any = {
      get: () => `multipart/form-data; boundary=${boundary}`,
      req: createReq(multipartBody(boundary)),
      status: 200,
      body: null,
    }

    await layer.stack[0](ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ success: false, transcript: '', error: 'No audio file found' })
    expect(saveSttUploadMock).not.toHaveBeenCalled()
  })

  it('surfaces upload validation errors from unsupported, empty, or oversized audio', async () => {
    const layer = await loadSttRouteLayer()
    const boundary = '----hermes-test-boundary'
    saveSttUploadMock.mockRejectedValue(Object.assign(new Error('Unsupported audio format'), { status: 400 }))
    const ctx: any = {
      get: () => `multipart/form-data; boundary=${boundary}`,
      req: createReq(multipartBody(boundary, 'recording.txt')),
      status: 200,
      body: null,
    }

    await layer.stack[0](ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ success: false, transcript: '', error: 'Unsupported audio format' })
    expect(transcribeWithHermesMock).not.toHaveBeenCalled()
  })

  it('saves the uploaded audio and returns the transcript', async () => {
    const layer = await loadSttRouteLayer()
    const boundary = '----hermes-test-boundary'
    const body = multipartBody(boundary, 'recording.webm')
    const ctx: any = {
      get: () => `multipart/form-data; boundary=${boundary}`,
      req: createReq(body),
      status: 200,
      body: null,
    }

    await layer.stack[0](ctx)

    expect(saveSttUploadMock).toHaveBeenCalledWith({
      filename: 'recording.webm',
      data: Buffer.from('audio-bytes'),
    })
    expect(transcribeWithHermesMock).toHaveBeenCalledWith('/tmp/hermes-stt.webm')
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ success: true, transcript: 'hello world', provider: 'local' })
  })

  it('returns 502 when Hermes transcription fails', async () => {
    const layer = await loadSttRouteLayer()
    const boundary = '----hermes-test-boundary'
    transcribeWithHermesMock.mockResolvedValue({
      success: false,
      transcript: '',
      error: 'provider failed',
    })
    const ctx: any = {
      get: () => `multipart/form-data; boundary=${boundary}`,
      req: createReq(multipartBody(boundary, 'recording.webm')),
      status: 200,
      body: null,
    }

    await layer.stack[0](ctx)

    expect(ctx.status).toBe(502)
    expect(ctx.body).toEqual({ success: false, transcript: '', error: 'provider failed' })
  })
})

describe('stt upload validation', () => {
  it('accepts browser and voice-message audio extensions', async () => {
    const service = await vi.importActual<typeof import('../../packages/server/src/services/hermes/stt')>('../../packages/server/src/services/hermes/stt')

    expect(service.isSupportedAudioFilename('recording.webm')).toBe(true)
    expect(service.isSupportedAudioFilename('voice.ogg')).toBe(true)
    expect(service.isSupportedAudioFilename('voice.txt')).toBe(false)
  })

  it('rejects unsupported, empty, and oversized audio uploads', async () => {
    const service = await vi.importActual<typeof import('../../packages/server/src/services/hermes/stt')>('../../packages/server/src/services/hermes/stt')

    expect(() => service.assertValidAudioUpload({ filename: 'recording.txt', data: Buffer.from('x') })).toThrow('Unsupported audio format')
    expect(() => service.assertValidAudioUpload({ filename: 'recording.webm', data: Buffer.alloc(0) })).toThrow('Audio file is empty')
    expect(() => service.assertValidAudioUpload({ filename: 'recording.webm', data: Buffer.alloc(25 * 1024 * 1024 + 1) })).toThrow('Audio file too large')
  })
})
