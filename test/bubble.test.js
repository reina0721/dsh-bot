import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBubbles } from '../src/delivery/bubble.js'
import { buildReplyPlan, buildFallbackPlan } from '../src/delivery/plan.js'

const tagged = values => values.map(value => `<bubble>${value}</bubble>`).join('')

test('bubble protocol: canonical, case, whitespace, empty and omitted closing', () => {
  assert.deepEqual(parseBubbles(tagged(['哈？', '杂鱼就是杂鱼喵。'])), ['哈？', '杂鱼就是杂鱼喵。'])
  assert.deepEqual(parseBubbles(' \n< BUBBLE > 完整回答。 </ BUBBLE >\n<bubble> </bubble>'), ['完整回答。'])
  assert.deepEqual(parseBubbles('<bubble\n>第一句。</bubble\n>\n<bubble\t>第二句。</bubble>'), ['第一句。', '第二句。'])
  assert.deepEqual(parseBubbles('<bubble>第一句。<bubble>第二句。'), ['第一句。', '第二句。'])
  for (const text of ['', ' \n ', null, undefined, '<bubble></bubble>']) assert.deepEqual(parseBubbles(text), [])
})

test('bubble protocol: malformed markers are invisible without discarding body or other markup', () => {
  for (const text of ['</bubble>答复< bubble', '<bubble>答复</bubble', '<bubble 答复', '<bubble data-x="oops">答复</bubble>']) {
    assert.deepEqual(parseBubbles(text), ['答复'], text)
  }
  assert.deepEqual(parseBubbles('前文<bubble>正文</bubble>尾文'), ['前文', '正文尾文'])
  assert.deepEqual(parseBubbles('<b>正文</b> <bubblegum>'), ['<b>正文</b> <bubblegum>'])
})

test('bubble protocol: no-tag and tagged one-shot ignore legacy maxChars through 2000 chars', () => {
  for (const size of [19, 130, 750, 2000]) {
    const text = '字'.repeat(size)
    assert.deepEqual(parseBubbles(text, { maxChars: 80 }), [text])
    assert.deepEqual(parseBubbles(tagged([text]), { maxChars: 80 }), [text])
  }
})

test('bubble protocol: cap merges remaining bubbles with separators, never truncates', () => {
  const values = ['一。', '二。', '三。', '四。', '五。']
  assert.deepEqual(parseBubbles(tagged(values)), ['一。', '二。', '三。\n四。\n五。'])
  assert.deepEqual(parseBubbles(tagged(values), { maxParts: 1 }), [values.join('\n')])
  assert.equal(parseBubbles(tagged(Array(12).fill('句。')), { maxParts: 99 }).length, 10)
})

test('bubble protocol: only >2000 activates punctuation safety; cap preserves overflow', () => {
  const text = '这是完整的一句话。'.repeat(300)
  const parts = parseBubbles(tagged([text]), { maxParts: 3, maxChars: 80 })
  assert.equal(parts.length, 2, 'valid tags use 2000, not the legacy target')
  assert.ok(parts[0].endsWith('。'))
  assert.ok(parts[0].length <= 2000)
  assert.equal(parts.join(''), text)
  const legacy = parseBubbles(text, { maxParts: 3, maxChars: 80 })
  assert.equal(legacy.length, 3)
  assert.ok(legacy[0].length <= 80)
  assert.equal(legacy.join(''), text)
  assert.equal(parseBubbles('字'.repeat(6000), { maxParts: 2 }).join('').length, 6000)
})

test('bubble protocol: split=false and planner recovery strip tags into one message', () => {
  const text = tagged(['完整句。', '再一句。'])
  assert.deepEqual(parseBubbles(text, { split: false }), ['完整句。\n再一句。'])
  assert.equal(parseBubbles(tagged(['字'.repeat(3000)]), { split: false })[0].length, 3000)
  const turn = { chatType: 'group', chatId: 'g', senderId: 'u', messages: [{ messageId: 'm' }] }
  for (const plan of [buildReplyPlan({ text, turn, replyCfg: { split: false } }), buildFallbackPlan({ text, turn })]) {
    assert.equal(plan.parts.length, 1)
    assert.equal(plan.parts[0].segments.at(-1).data.text, '完整句。\n再一句。')
    assert.equal(plan.parts[0].delayAfterMs, 0)
  }
})
