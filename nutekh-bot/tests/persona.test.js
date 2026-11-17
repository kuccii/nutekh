const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

const { PERSONA } = require('../src/brain')

test('persona is framed for Rwanda, not Tanzania', () => {
  assert.match(PERSONA, /Kigali, Rwanda/)
  assert.doesNotMatch(PERSONA, /Dar es Salaam|Tanzania/)
})

test('persona makes English the default and demotes Swahili', () => {
  assert.match(PERSONA, /English is the default/i)
  assert.doesNotMatch(PERSONA, /Kiswahili stays\s+Kiswahili/)
  assert.doesNotMatch(PERSONA, /first-class/)
})

test('persona tells the bot to name the relevant service', () => {
  assert.match(PERSONA, /name the relevant Nutekh service/i)
})
