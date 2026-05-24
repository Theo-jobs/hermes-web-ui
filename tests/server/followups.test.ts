import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../packages/server/src/services/gateway-bootstrap', () => ({
  getGatewayManagerInstance: vi.fn(() => ({
    getUpstream: vi.fn(() => 'http://example.test'),
    getApiKeyForUpstream: vi.fn(() => 'test-api-key'),
  })),
}))

function createMockCtx() {
  return {
    request: {
      body: {
        messages: [
          { role: 'user', content: '帮我检查状态' },
          { role: 'assistant', content: '服务在线' },
        ],
      },
    },
    body: null as any,
  }
}

describe('hermes followups controller', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('enables xhigh reasoning on the followup model request by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ output_text: '{"follow_ups":["继续？"]}' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { generateFollowups } = await import('../../packages/server/src/controllers/hermes/followups')
    const ctx = createMockCtx()

    await generateFollowups(ctx)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.test/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.reasoning).toEqual({ enabled: true, effort: 'xhigh' })
    expect(ctx.body).toEqual({ suggestions: ['继续？'], source: 'model' })
  })
})
