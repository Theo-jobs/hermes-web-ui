import { describe, expect, it } from 'vitest'
import { getCompressionTriggerTokens } from '../../packages/server/src/services/hermes/run-chat/compression'

describe('chat run compression threshold', () => {
  it('triggers context compression at 70% of the resolved context length', () => {
    expect(getCompressionTriggerTokens(100_000)).toBe(70_000)
    expect(getCompressionTriggerTokens(256_000)).toBe(179_200)
  })
})
