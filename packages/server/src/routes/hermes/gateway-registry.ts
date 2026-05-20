import Router from '@koa/router'
import * as ctrl from '../../controllers/hermes/gateway-registry'

export const gatewayRegistryRoutes = new Router()

gatewayRegistryRoutes.get('/api/hermes/gateway-registry', ctrl.listGateways)
gatewayRegistryRoutes.post('/api/hermes/gateway-registry', ctrl.upsertGateway)
gatewayRegistryRoutes.put('/api/hermes/gateway-registry/:id', ctrl.upsertGateway)
gatewayRegistryRoutes.delete('/api/hermes/gateway-registry/:id', ctrl.deleteGateway)
gatewayRegistryRoutes.get('/api/hermes/gateway-registry/:id/health', ctrl.testGateway)
gatewayRegistryRoutes.post('/api/hermes/gateway-registry/:id/test', ctrl.testGateway)
gatewayRegistryRoutes.get('/api/hermes/spaces', ctrl.listSpaces)
gatewayRegistryRoutes.post('/api/hermes/spaces', ctrl.upsertSpace)
gatewayRegistryRoutes.put('/api/hermes/spaces/:id', ctrl.upsertSpace)
gatewayRegistryRoutes.delete('/api/hermes/spaces/:id', ctrl.deleteSpace)
