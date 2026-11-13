#!/usr/bin/env node
/**
 * Seed Nutekh knowledge into the local SQLite memory.
 *
 * - Inserts knowledge/faq.json rows (idempotent).
 * - Computes embeddings for any row that has none, when the embed service is up.
 *
 * Usage:
 *   npm run seed
 *   npm run seed -- --no-embed
 */
require('../src/env')

const knowledge = require('../src/knowledge')
const { embed } = require('../src/embed')
const { setVec } = require('../src/memory')

const BATCH = 32

async function embedPending() {
  const pending = knowledge.pendingEmbeddings(5000)
  if (!pending.length) {
    console.log('embeddings: nothing pending')
    return { done: 0, failed: 0 }
  }
  console.log(`embeddings: ${pending.length} row(s) pending`)

  let done = 0
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH)
    let vectors = null
    try { vectors = await embed(slice.map((r) => r.text), 'passage') } catch { vectors = null }
    if (!vectors || !vectors.length) {
      console.log('embeddings: embed service unavailable — run this again once it is up')
      return { done, failed: pending.length - done }
    }
    for (let j = 0; j < slice.length; j++) {
      if (!vectors[j]) continue
      setVec(slice[j].id, vectors[j])
      done++
    }
    console.log(`embeddings: ${done}/${pending.length}`)
  }
  return { done, failed: pending.length - done }
}

async function main() {
  const seeded = knowledge.ensureSeeded()
  console.log(`knowledge: ${seeded.added} added, ${seeded.skipped} already present, ${seeded.total} in faq.json`)

  if (process.argv.includes('--no-embed')) {
    console.log('embeddings: skipped (--no-embed)')
    return
  }
  const res = await embedPending()
  if (res.failed) process.exitCode = 0
}

main().catch((e) => {
  console.error('seed failed:', e?.message || e)
  process.exit(1)
})
