import { buildReplyPlan } from './reply-delivery-plan.js'

export function setup(api) {
  api.delivery.registerPlanner({ id: 'builtin-reply-delivery', stage: 'format', order: 0, plan: buildReplyPlan })
  api.health?.report({ state: 'healthy', result: 'observation' })
}
