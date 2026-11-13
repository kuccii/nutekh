

const NEG = /(don'?t|do not|can ?not|can'?t|not able to|unable to|wasn'?t|was not|haven'?t|have not|no longer|don'?t really|do not have|ne peux pas|ne pas|n'ai pas|pas acc[eè]s)/i
const OBJ = /\b(transcripts?|transcriptions?|recordings?|the videos?|access to the (?:video|session|meeting|recording))\b/i

const DEFLECT = /\b(private (?:conversation|chat|message)|conversations? priv[ée]es?|messages? priv[ée]s?|[ée]changes? (?:priv[ée]|entre (?:les )?membres)|acc[eé]der (?:aux?|à|a) (?:conversations?|messages?|[ée]changes?)|access to (?:your|what) (?:conversations?|messages?|others))/i

function scrubSegment(seg) {
  const isDisclaimer = NEG.test(seg) && (OBJ.test(seg) || DEFLECT.test(seg))
  if (!isDisclaimer) return seg

  const m = seg.match(/\b(?:but|however|though|although|mais|toutefois|cependant|par contre)\b[,\s]*(.+)/i)
  if (m && m[1] && m[1].trim().length > 2) {
    const t = m[1].trim()
    return t.charAt(0).toUpperCase() + t.slice(1)
  }
  return ''
}

function fixLeadWord(text, lang) {
  if (!text || !lang) return text
  if (lang === 'English') return text.replace(/^(\s*)Non(?=[,\s])/, '$1No').replace(/^(\s*)Oui(?=[,\s])/, '$1Yes')
  if (lang === 'French') return text.replace(/^(\s*)No(?=[,\s])/, '$1Non').replace(/^(\s*)Yes(?=[,\s])/, '$1Oui')
  return text
}

function cleanReply(text, lang) {
  if (!text) return fixLeadWord(text, lang)
  const blocks = text.split(/(\n{2,})/)
  const out = blocks.map((block) => {
    if (/^\n+$/.test(block)) return block
    const parts = block.split(/(?<=[.?!])\s+/)
    const kept = []
    for (const seg of parts) {
      const s = scrubSegment(seg)
      if (s && s.trim()) kept.push(s.trim())
    }
    return kept.join(' ')
  })
  let s = out.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s*[,;:.\-—]\s*/, '').trim()
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1)

  if (!s || s.length < 12) return fixLeadWord(text, lang)
  return fixLeadWord(s, lang)
}

function stripLeadingIntro(text) {
  if (!text) return text
  let s = text
  s = s.replace(/^\s*(bonjour|bonsoir|salut|coucou|hello+|hi+|hey|hola)\b\s*[!,.…]*\s*/i, '')
  s = s.replace(/^\s*(je suis (?:votre|ton|l[’'e ]) ?assistant[^.!?\n]*[.!?]|i'?m (?:your |the )?[^.!?\n]*assistant[^.!?\n]*[.!?])\s*/i, '')
  s = s.replace(/^\s*(bonjour|bonsoir|salut|hello+|hi+)\b\s*[!,.…]*\s*/i, '')
  s = s.replace(/^[\s—–\-]+/, '').trim()
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1)
  return s.length >= 5 ? s : text
}

module.exports = { cleanReply, stripLeadingIntro }
