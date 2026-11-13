const { chat } = require('./llm')

const BOT_ALIASES = ['nutekh assistant', 'nutekh_bot', 'nutekh bot', 'nutekh', 'nutek', 'assistant', 'bot']

const TEXT_MENTION = new RegExp(
  '@\\s*(' + BOT_ALIASES.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s_-]*')).join('|') + ')\\b(?!\\d)',
  'i'
)

const NAME_CALL = new RegExp(
  '^\\s*(?:hey|hi|hello|salut|bonjour|ok|eh|yo|habari|mambo)?[\\s,]*(' +
    BOT_ALIASES.filter((a) => a !== 'bot' && a !== 'assistant').map((a) => a.replace(/ /g, '[\\s_-]*')).join('|') +
    ')\\b[\\s,:!?]*',
  'i'
)

const AUDIENCE_GREETING = /\b(good (morning|afternoon|evening)[,! ]+(all|everyone|everybody|team|guys|folks)|hi all|hello (all|everyone|everybody)|hey (all|everyone|everybody)|tout le monde|bonjour [aà] tous)\b/i

function isBroadcast(text, nTags) {
  const t = String(text || '')
  if (nTags >= 10) return true
  if (AUDIENCE_GREETING.test(t)) return true
  if (nTags >= 3 && /\b(everyone|everybody|all of you|you all|hi all|good (morning|evening|afternoon)|tout le monde|bonjour [aà] tous|salut [aà] tous|chers|team|timu)\b/i.test(t)) return true

  const withoutTags = t.replace(/@\d{5,}/g, '').replace(/[\s,;:·•\-–—"'?!.]/g, '')
  if (nTags >= 3 && withoutTags.length < 25) return true
  return false
}

function addressingSignals(text, ctx = {}) {
  const t = String(text || '').trim()
  const { quotedBot = false, mentionsBotJid = false, nTags = 0 } = ctx

  if (quotedBot) return { addressed: true, how: 'reply-to-bot', sure: true }

  const broadcast = isBroadcast(t, nTags)
  const textMention = TEXT_MENTION.test(t)
  const nameCall = NAME_CALL.test(t)
  const tagged = mentionsBotJid || textMention || nameCall

  const thirdPerson = /\b(him|her|it|he'?s|she'?s|it'?s|they|this bot|the bot|that bot)\b/i.test(t)
  const congrats = /\b(congrat\w*|bravo|well done|f[ée]licitations?|kudos|asante)\b/i.test(t)

  const addressesSeveral = nTags >= 3 && /\b(which of you|who(ever)? (of you|among)|you guys|anyone|any of you|lequel d'entre vous|qui parmi vous)\b/i.test(t)
  const aboutBot = thirdPerson || congrats || addressesSeveral

  if (tagged && !broadcast && !aboutBot) {
    return {
      addressed: true,
      how: mentionsBotJid ? 'jid-mention' : textMention ? 'text-mention' : 'name-call',
      sure: true,
    }
  }

  if (tagged && aboutBot && !broadcast) {
    return { addressed: false, how: 'talking-about-bot?', sure: false }
  }

  if (tagged && broadcast) {
    return { addressed: false, how: 'mass-tag', sure: !/\?/.test(t) }
  }
  return { addressed: false, how: 'not-addressed', sure: true }
}

const _cache = new Map()
const CACHE_MAX = 500

async function arbitrate(text, ctx = {}, fallback = false) {
  const t = String(text || '').trim()
  if (!t) return fallback
  const k = t.slice(0, 300)
  if (_cache.has(k)) return _cache.get(k)

  const prompt = `In a WhatsApp group there is an assistant bot for Nutekh, a digital transformation agency (names: Nutekh Assistant, Nutekh, Nutekh Bot, "the bot").
Decide whether THIS message is addressed TO the bot (someone talking to it, asking it something, calling it, correcting it) or NOT (talking to other people, or merely mentioning the bot or the company while talking to the group).
A message that tags many people at once to broadcast news is NOT addressed to the bot.
A message that calls the bot by name, even casually ("@bot hello", "Nutekh?", "bot are you awake"), IS addressed to it.

MESSAGE:
"""${t.slice(0, 700)}"""

Answer with ONE word only: ADDRESSED or NOT.`

  let verdict = fallback
  try {
    const r = await chat([{ role: 'user', content: prompt }], { max_tokens: 8 })
    const s = String(r || '').toUpperCase()
    if (/\bADDRESSED\b/.test(s)) verdict = true
    else if (/\bNOT\b/.test(s)) verdict = false
  } catch (e) {
    console.log('  addressing: LLM unavailable, deterministic fallback -', e?.message)
  }
  if (_cache.size >= CACHE_MAX) _cache.clear()
  _cache.set(k, verdict)
  return verdict
}

async function isAddressed(text, ctx = {}, opts = {}) {
  const sig = addressingSignals(text, ctx)
  if (sig.sure || opts.useLlm === false) return { ...sig, arbitrated: false }
  const verdict = await arbitrate(text, ctx, sig.addressed)
  return { addressed: verdict, how: sig.how + (verdict !== sig.addressed ? ' -> LLM:corrected' : ' -> LLM:confirmed'), sure: true, arbitrated: true }
}

module.exports = { isAddressed, addressingSignals, arbitrate, isBroadcast, TEXT_MENTION, NAME_CALL, BOT_ALIASES }
