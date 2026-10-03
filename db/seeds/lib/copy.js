// Streams rows into PostgreSQL with COPY ... FROM STDIN.
//
// INSERT sends one statement per row (or per batch) that PostgreSQL must parse and plan.
// COPY opens one data stream and PostgreSQL reads plain CSV lines from it, which is the
// fastest way to load lots of rows. Constraints, foreign keys and indexes still apply.
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { from: copyFrom } = require('pg-copy-streams');

// One CSV field. Values with commas, quotes or newlines are quoted; null becomes an
// empty unquoted field, which COPY ... (FORMAT csv) reads as NULL.
function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) || text === '' ? `"${text.replace(/"/g, '""')}"` : text;
}

// rows: any iterable of arrays. Lines are sent in chunks of 2,000 to keep the stream efficient.
async function copyInto(client, table, columns, rows) {
  function* chunks() {
    let buffer = [];
    for (const row of rows) {
      buffer.push(row.map(csvField).join(','));
      if (buffer.length === 2000) {
        yield `${buffer.join('\n')}\n`;
        buffer = [];
      }
    }
    if (buffer.length) yield `${buffer.join('\n')}\n`;
  }

  const stream = client.query(copyFrom(`COPY ${table} (${columns.join(', ')}) FROM STDIN (FORMAT csv)`));
  await pipeline(Readable.from(chunks()), stream);
  return stream.rowCount;
}

module.exports = { copyInto };
