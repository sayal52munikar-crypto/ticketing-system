// Shared helpers for the backup/restore scripts: find PostgreSQL's command-line tools
// and run them with the connection details from .env.
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// pg_dump/pg_restore must be at least as new as the server. Prefer the PATH, then the
// default Windows install folder.
function pgTool(name) {
  const windowsDefault = `C:\\Program Files\\PostgreSQL\\17\\bin\\${name}.exe`;
  return fs.existsSync(windowsDefault) ? windowsDefault : name;
}

// Splits a connection URL for a command-line tool. The password goes in the PGPASSWORD
// environment variable instead of the arguments: command lines are visible to other
// programs on the machine (Task Manager, ps), environment variables of a process are not.
function cliConnection(url) {
  const parsed = new URL(url);
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  return { dbname: parsed.toString(), env: { ...process.env, PGPASSWORD: password } };
}

// Runs a tool against a database URL, streaming its output; resolves when it exits with code 0.
function run(tool, args, url) {
  const { dbname, env } = cliConnection(url);
  return new Promise((resolve, reject) => {
    const child = spawn(pgTool(tool), [...args, '--dbname', dbname], { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${tool} exited with code ${code}`))));
  });
}

// The same server, but a different database name.
function urlForDatabase(databaseName) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function sourceDatabaseName() {
  return new URL(process.env.DATABASE_URL).pathname.slice(1);
}

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

module.exports = { run, urlForDatabase, sourceDatabaseName, BACKUP_DIR };
