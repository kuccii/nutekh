const MARKERS = {
  fr: ['bonjour', 'merci', 'vous', 'nous', 'je', 'est', 'pour', 'avec', 'prix', 'combien', "s'il", 'la', 'les', 'des', 'une'],
  rw: ['muraho', 'mwaramutse', 'amakuru', 'murakoze', 'yego', 'oya', 'kandi', 'cyane', 'ufite', 'nshaka', 'ndashaka', 'igiciro', 'amafaranga', 'kuki', 'gute'],
  sw: ['habari', 'jambo', 'mambo', 'karibu', 'asante', 'ndiyo', 'hapana', 'naomba', 'bei', 'gani', 'ngapi', 'vipi', 'nzuri', 'sana', 'ninataka', 'tunataka', 'pesa', 'shilingi'],
}

const LANG_NAMES = { en: 'English', rw: 'Kinyarwanda', fr: 'French', sw: 'Swahili' }
const MIN_SCORE = 2
const MIN_REPAIR_CHARS = 40

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function score(text, markers) {
  const t = String(text || '').toLowerCase()
  let n = 0
  for (const m of markers) {
    if (new RegExp(`(^|[^a-zà-ÿ])${escapeRe(m)}([^a-zà-ÿ]|$)`).test(t)) n++
  }
  return n
}

function detectLang(text) {
  let best = 'en'
  let bestScore = 0
  let tie = false
  for (const lang of ['rw', 'fr', 'sw']) {
    const s = score(text, MARKERS[lang])
    if (s > bestScore) { best = lang; bestScore = s; tie = false }
    else if (s === bestScore && s > 0) tie = true
  }
  if (bestScore < MIN_SCORE || tie) return 'en'
  return best
}

function needsRepair(expected, replyText) {
  const body = String(replyText || '')
  if (body.length < MIN_REPAIR_CHARS) return false
  return detectLang(body) !== expected
}

module.exports = { detectLang, needsRepair, LANG_NAMES }
