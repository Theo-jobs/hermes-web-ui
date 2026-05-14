import { gatewayRegistryService } from '../../services/hermes/gateway-registry'
import { getGatewayManagerInstance } from '../../services/gateway-bootstrap'

function badRequest(ctx: any, err: any) {
  ctx.status = 400
  ctx.body = { error: err?.message || 'invalid request' }
}

export async function listGateways(ctx: any) {
  ctx.body = { gateways: gatewayRegistryService.listGateways() }
}

export async function upsertGateway(ctx: any) {
  try {
    const body = ctx.request.body || {}
    const gateway = gatewayRegistryService.upsertGateway({
      ...body,
      id: ctx.params.id || body.id,
    })
    ctx.body = { gateway }
  } catch (err) {
    badRequest(ctx, err)
  }
}

export async function deleteGateway(ctx: any) {
  try {
    const deleted = gatewayRegistryService.deleteGateway(ctx.params.id)
    if (!deleted) {
      ctx.status = 404
      ctx.body = { error: 'gateway not found' }
      return
    }
    ctx.body = { ok: true }
  } catch (err) {
    badRequest(ctx, err)
  }
}

export async function testGateway(ctx: any) {
  try {
    const gateway = gatewayRegistryService.getGateway(ctx.params.id)
    if (!gateway) {
      ctx.status = 404
      ctx.body = { error: 'gateway not found' }
      return
    }
    const mgr = getGatewayManagerInstance()
    const result = await gatewayRegistryService.testGateway(ctx.params.id, 3000, {
      upstream: gateway.upstream || mgr?.getUpstream?.(gateway.profile),
      apiKey: mgr?.getApiKeyForUpstream?.(gateway.profile) ?? null,
    })
    ctx.body = result
  } catch (err: any) {
    if (err?.message === 'gateway not found') {
      ctx.status = 404
      ctx.body = { error: err.message }
      return
    }
    badRequest(ctx, err)
  }
}

export async function listSpaces(ctx: any) {
  ctx.body = { spaces: gatewayRegistryService.listSpaces() }
}
