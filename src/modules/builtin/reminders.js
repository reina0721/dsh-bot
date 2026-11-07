import { createReminderEngine } from '../../reminders/service.js'
import { reminderCommand } from '../../reminders/commands.js'

export function createBuiltinReminders(api, { clock = { now: Date.now } } = {}) {
  const getConfig = () => api.legacyConfig.section('cognition.reminders')
  const reminders = createReminderEngine({
    repository: api.reminderRepository, getConfig, scheduler: api.scheduler, health: api.health, clock, logger: api.log,
    // The command service enforces ownerOnly before entering these private operations.
    owner() {},
    deliver: payload => api.delivery.send(payload),
  })
  for (const name of ['remind', 'reminders', 'forgetreminder']) {
    api.registerCommand(name, ({ turn, parsed }) => {
      if (!api.access.canSend({ chatType: turn.chatType, chatId: turn.chatId }).allowed) return ''
      if (!getConfig().enabled) return '提醒未启用（cognition.reminders.enabled）。'
      return reminderCommand({ turn, parsed, reminders })
    }, { ownerOnly: true, overrideBuiltin: true })
  }
  api.providers.register('reminders', { start: reminders.start, stop: options => options?.dispose ? reminders.dispose() : reminders.stop() })
  return reminders
}

export function setup(api) {
  const reminders = createBuiltinReminders(api)
  return () => reminders.dispose()
}
