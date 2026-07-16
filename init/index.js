#!/usr/bin/env node
'use strict';

const path = require('path');
const fs   = require('fs');

// In the ISO, everything is bundled at /nodedos/bundle.js.
// In dev, require directly from the compiled dist/ packages.
const BUNDLE = '/nodedos/bundle.js';

let NodeDOSServer, PosixDriver, startShell;

if (fs.existsSync(BUNDLE)) {
  const b     = require(BUNDLE);
  NodeDOSServer = b.NodeDOSServer;
  PosixDriver   = b.PosixDriver;
  startShell    = b.startShell;
} else {
  const root = path.join(__dirname, '..');
  ({ NodeDOSServer } = require(path.join(root, 'packages/server/dist/index.js')));
  ({ PosixDriver }   = require(path.join(root, 'packages/fs-drivers/dist/index.js')));
  ({ startShell }    = require(path.join(root, 'packages/shell/dist/index.js')));
}

const PORT     = parseInt(process.env.NODEDOS_PORT  || '9001', 10);
const FS_ROOT  = process.env.NODEDOS_ROOT || (process.pid === 1 ? '/' : '/tmp/nodedos-root');
const SECRET   = process.env.NODEDOS_SECRET || undefined;

async function main() {
  process.stdout.write('\x1b[2J\x1b[H'); // clear screen

  console.log([
    '',
    '  ███╗   ██╗ ██████╗ ██████╗ ███████╗██████╗  ██████╗ ███████╗',
    '  ████╗  ██║██╔═══██╗██╔══██╗██╔════╝██╔══██╗██╔═══██╗██╔════╝',
    '  ██╔██╗ ██║██║   ██║██║  ██║█████╗  ██║  ██║██║   ██║███████╗',
    '  ██║╚██╗██║██║   ██║██║  ██║██╔══╝  ██║  ██║██║   ██║╚════██║',
    '  ██║ ╚████║╚██████╔╝██████╔╝███████╗██████╔╝╚██████╔╝███████║',
    '  ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝╚═════╝  ╚═════╝ ╚══════╝',
    '',
    '  v0.1.0  —  Plan 9-inspired Distributed Operating System',
    '',
  ].join('\n'));

  if (process.pid === 1) {
    console.log('  [init] Running as PID 1');
  }
  console.log(`  [init] Root filesystem : ${FS_ROOT}`);
  console.log(`  [init] Server port     : ${PORT}`);
  console.log('');

  // Start the local NodeDOS server
  const server = new NodeDOSServer({ secret: SECRET });
  server.namespace.mount('/', new PosixDriver(FS_ROOT));

  try {
    await server.listen(PORT, '127.0.0.1');
    console.log(`  [init] NodeDOS server ready`);
    console.log('');
  } catch (err) {
    console.error(`  [init] Failed to start server: ${err.message}`);
    process.exit(1);
  }

  // Register shutdown handler — when PID 1 exits, kernel panics/halts
  process.on('SIGTERM', () => shutdown(server));
  process.on('SIGINT',  () => shutdown(server));

  // Drop into interactive shell
  await startShell(`localhost:${PORT}`, { secret: SECRET });

  shutdown(server);
}

function shutdown(server) {
  server.close();
  console.log('\nNodeDOS halted.');
  if (process.pid === 1) {
    require('child_process').execFileSync('/sbin/halt', ['-f'], { stdio: 'inherit' });
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
