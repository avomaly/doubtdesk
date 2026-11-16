import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['--env-file=.env', '--env-file=.env.server', 'server.mjs'], {
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    { stdio: 'inherit' },
  ),
];

let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  children.forEach((child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  });
}

children.forEach((child) => {
  child.on('error', (error) => {
    console.error('Could not start a DoubtDesk service:', error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
});

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
