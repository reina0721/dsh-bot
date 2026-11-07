export function setup(api) {
  async function setStatus({ turn, settings }, eventType) {
    if (settings.typingEnabled !== true || turn?.chatType !== 'private') {
      api.health?.report({ state: 'healthy', result: 'observation', reasonCode: 'BUSINESS_DISABLED' })
      return
    }
    // Best effort only; gateway errors may contain private chat IDs.
    try { await api.status.setInputStatus(String(turn.chatId), eventType) } catch (error) {}
  }

  api.turn.register({
    id: 'builtin-typing',
    onStart: (context) => setStatus(context, 1),
    onEnd: (context) => setStatus(context, 2),
  })
}
