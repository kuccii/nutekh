
const fs = require('fs')

function makeSerializer() {
  const m = new Map()
  return (key, fn) => {
    const prev = m.get(key) || Promise.resolve()
    const next = prev.then(fn, fn).catch(() => {})
    m.set(key, next)
    next.finally(() => { if (m.get(key) === next) m.delete(key) })
    return next
  }
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data))
  fs.renameSync(tmp, file)
}

module.exports = { makeSerializer, writeJsonAtomic }
