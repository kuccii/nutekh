const fs = require('fs')
const os = require('os')
const path = require('path')

function tmpDataDir(prefix = 'nutekh-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

module.exports = { tmpDataDir }
