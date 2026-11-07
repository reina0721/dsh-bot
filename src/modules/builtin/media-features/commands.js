// Command presentation belongs to the feature module; host checks audience/access first.
function oneLine(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export async function biliCommand({ parsed, bilibili, getConfig }) {
  if (getConfig().bilibili?.enabled !== true) return 'B站内容未启用'
  if (!bilibili) return 'B站内容服务不可用'
  try {
    const subcommand = /^(comments|share)(?:\s+(.*))?$/i.exec(parsed.args)
    if (subcommand) {
      const kind = subcommand[1].toLowerCase()
      const bvid = (subcommand[2] || '').trim()
      if (!bvid) return `用法：/bili ${kind} BV号`
      if (kind === 'share') return (await bilibili.share(bvid)).url
      const result = await bilibili.comments(bvid)
      const items = Array.isArray(result?.items) ? result.items : []
      if (!items.length) return '没有可显示的 B站公开评论。'
      return items.map((item, index) => `${index + 1}. ${oneLine(item.author, 40)} · 赞 ${Number(item.like) || 0}\n${oneLine(item.content, 500)}`).join('\n')
    }
    let result
    if (parsed.args.toLowerCase() === 'hot') result = await bilibili.hot()
    else if (/^BV[0-9A-Za-z]{3,}$/i.test(parsed.args)) result = await bilibili.video(parsed.args)
    else if (parsed.args) result = await bilibili.search(parsed.args)
    else return '用法：/bili hot | /bili 关键词 | /bili BV号 | /bili comments BV号 | /bili share BV号'
    const items = Array.isArray(result?.items) ? result.items : []
    if (!items.length) return '没有找到 B站视频。'
    const lines = items.map((item, index) => `${index + 1}. ${oneLine(item.title, 100)}\n${oneLine(item.author, 40)} · 播放 ${Number(item.play) || 0} · ${item.duration || '00:00'}\n${item.url}`)
    return lines.join('\n')
  } catch (error) {
    return `B站请求失败：${oneLine(error?.message || error, 100)}`
  }
}

export async function stickerCommand({ parsed, commandToken, port, authorize }) {
  if (!authorize()) return '表情包功能未启用。'
  if (!port.status().stickerSendAvailable) return '表情包服务不可用。'
  try {
    const item = await port.stickers.pick({ tag: parsed.args })
    if (!item) return '还没有表情包，先在媒体面板上传'
    const result = await port.stickers.send({ commandToken, stickerId: item.id })
    if (result?.missing) return '表情包文件不存在。'
    return ''
  } catch (error) { return `表情包发送失败：${oneLine(error?.message || error, 100)}` }
}
