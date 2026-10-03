// Loads a query from db/queries/, without its "--" comment lines and final semicolon.
const fs = require('fs');
const path = require('path');

function loadQuery(fileName) {
  return fs.readFileSync(path.join(__dirname, '..', 'db', 'queries', fileName), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .replace(/;\s*$/, '');
}

module.exports = { loadQuery };
