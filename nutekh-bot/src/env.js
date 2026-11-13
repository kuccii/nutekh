/**
 * Minimal .env loader.
 *
 * Node 20 has no stable --env-file flag, and pm2/systemd do not always pass a
 * file, so the bot loads `.env` itself. Existing process env always wins, which
 * keeps systemd/pm2 overrides authoritative.
 */
const fs = require('fs')
const path = require('path')

const file = process.env.ENV_FILE || path.join(__dirname, '..', '.env')

if (fs.existsSync(file)) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { raw = '' }
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const key = m[1]
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value.replace(/\\n/g, '\n')
  }
}

module.exports = { envFile: file }
