#!/usr/bin/env node
/**
 * Ask the Nutekh brain without WhatsApp.
 *
 * Usage:
 *   npm run ask -- "How much is the Grow package?"
 *   npm run ask -- --group "Nutekh, do you integrate mobile money?"
 *   npm run ask -- --notes "Retail shop in Arusha" "Which package fits?"
 *
 * Requires a configured LLM (LLM_API_KEY, LLM_BASE_URL, CHAT_MODEL).
 */
require('../src/env')

const { answerDM, answerAuto } = require('../src/brain')
const { ensureSeeded } = require('../src/knowledge')

function parseArgs(argv) {
  const out = { group: false, notes: '', firstContact: true, text: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--group') out.group = true
    else if (a === '--returning') out.firstContact = false
    else if (a === '--notes') out.notes = argv[++i] || ''
    else if (a === '--help' || a === '-h') out.help = true
    else out.text.push(a)
  }
  out.text = out.text.join(' ').trim()
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.text) {
    console.log('Usage: npm run ask -- [--group] [--returning] [--notes "context"] "your question"')
    return
  }
  if (!process.env.LLM_API_KEY) {
    console.log('Missing LLM_API_KEY. Copy .env.example to .env and add a key.')
    process.exit(1)
  }

  const seed = ensureSeeded()
  if (seed.added) console.log(`knowledge: seeded ${seed.added} fact(s)`)

  const res = args.group
    ? await answerAuto(args.text, [], [], { addressed: true })
    : await answerDM(args.text, [], args.notes, { firstContact: args.firstContact })

  if (res.skipped) {
    console.log('[silent — the bot would not reply in a group to this message]')
    return
  }
  console.log('\n--- reply ---\n')
  console.log(res.reply)
  console.log(`\n(sources: ${res.sources})`)
  if (res.lead) console.log('\nlead captured:\n' + JSON.stringify(res.lead, null, 2))
}

main().catch((e) => {
  console.error('ask failed:', e?.message || e)
  process.exit(1)
})
