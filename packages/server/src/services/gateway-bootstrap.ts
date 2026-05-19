let gatewayManager: any = null

export function getGatewayManagerInstance(): any {
  if (gatewayManager) return gatewayManager
  try {
    // Lazy, non-destructive singleton: do not start/stop gateways from request paths.
    const { GatewayManager } = require('./hermes/gateway-manager')
    const { getActiveProfileName } = require('./hermes/hermes-profile')
    gatewayManager = new GatewayManager(getActiveProfileName())
  } catch {
    gatewayManager = null
  }
  return gatewayManager
}

export function setGatewayManagerInstanceForTest(manager: any): void {
  gatewayManager = manager
}
