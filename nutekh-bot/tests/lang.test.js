const test = require('node:test')
const assert = require('node:assert/strict')

const { detectLang, needsRepair, LANG_NAMES, confidentLang } = require('../src/lang')

test('detectLang defaults to English', () => {
  assert.equal(detectLang(''), 'en')
  assert.equal(detectLang('How much does the Grow package cost?'), 'en')
})

test('detectLang recognises French', () => {
  assert.equal(detectLang('Bonjour, combien coûte le pack Grow ? Merci beaucoup'), 'fr')
})

test('detectLang recognises Kinyarwanda', () => {
  assert.equal(detectLang('Muraho, igiciro cya Grow ni angahe? Murakoze'), 'rw')
})

test('detectLang recognises Swahili', () => {
  assert.equal(detectLang('Habari, bei ya Grow ni ngapi? Asante sana'), 'sw')
})

test('detectLang returns English on a tie or a single marker', () => {
  assert.equal(detectLang('Bonjour, hello'), 'en')
  assert.equal(detectLang('merci'), 'en')
})

test('needsRepair ignores a short reply', () => {
  assert.equal(needsRepair('en', 'Asante sana'), false)
})

test('needsRepair flags a clearly Swahili reply to an English message', () => {
  const sw = 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'
  assert.ok(sw.length >= 40)
  assert.equal(needsRepair('en', sw), true)
})

test('needsRepair leaves an English reply alone', () => {
  assert.equal(needsRepair('en', 'Grow starts at RWF 2M. Shall I book the free audit?'), false)
})

test('LANG_NAMES covers every detected language', () => {
  for (const l of ['en', 'rw', 'fr', 'sw']) assert.equal(typeof LANG_NAMES[l], 'string')
})

test('confidentLang is null for short or ambiguous text', () => {
  assert.equal(confidentLang(''), null)
  assert.equal(confidentLang('Combien?'), null)
  assert.equal(confidentLang('Bonjour, hello'), null)
})

test('confidentLang positively identifies a substantial English message', () => {
  assert.equal(confidentLang('How much does the Grow package cost?'), 'en')
  assert.equal(confidentLang('How much is Grow?'), 'en')
})

test('detectLang still defaults to en when nothing is confident', () => {
  assert.equal(detectLang('Combien?'), 'en')
  assert.equal(detectLang(''), 'en')
})
