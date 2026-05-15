import Router from '@koa/router'
import { generateFollowups } from '../../controllers/hermes/followups'

export const followupRoutes = new Router()

followupRoutes.post('/api/hermes/followups', generateFollowups)
