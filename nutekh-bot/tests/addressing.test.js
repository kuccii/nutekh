const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()

const { addressingSignals, isBroadcast } = require('../src/addressing')

test('text mention is addressed', () => {
  const s = addressingSignals('@nutekh how much is the Grow package?')
  assert.equal(s.addressed, true)
  assert.equal(s.sure, true)
  assert.equal(s.how, 'text-mention')
})

test('name call at the start is addressed', () => {
  const s = addressingSignals('Hey Nutekh, do you connect mobile money?')
  assert.equal(s.addressed, true)
  assert.equal(s.sure, true)
})

test('reply to the bot is addressed', () => {
  const s = addressingSignals('and what about POS?', { quotedBot: true })
  assert.equal(s.addressed, true)
  assert.equal(s.how, 'reply-to-bot')
})

test('mass tag broadcast is not addressed', () => {
  const tags = Array.from({ length: 12 }, (_, i) => `@2557000000${i}`).join(' ')
  const s = addressingSignals(`${tags} team meeting at 4pm`)
  assert.equal(s.addressed, false)
})

test('a plain message is not addressed', () => {
  const s = addressingSignals('We should order more stock tomorrow.')
  assert.equal(s.addressed, false)
})

test('casual congratulations are not treated as a prompt', () => {
  const s = addressingSignals('well done @nutekh team!')
  assert.equal(s.addressed, false)
})

test('isBroadcast detects hi-all style messages', () => {
  assert.equal(isBroadcast('good morning everyone', 0), true)
  assert.equal(isBroadcast('hello all, quick update', 0), true)
  assert.equal(isBroadcast('team meeting at 4pm', 4), true)
  assert.equal(isBroadcast('do you integrate POS?', 0), false)
  assert.equal(isBroadcast('Mambo Nutekh, do you connect POS?', 1), false)
})
