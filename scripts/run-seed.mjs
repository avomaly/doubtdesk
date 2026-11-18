import { spawn } from 'node:child_process';

const serverProc = spawn('node', ['--env-file=.env', '--env-file=.env.server', 'server.mjs'], {
  stdio: 'inherit',
});

// Wait for server health
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch('http://127.0.0.1:8787/api/health');
    if (res.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

const seedProc = spawn('node', ['--env-file=.env', '--env-file=.env.server', 'scripts/seed-demo.mjs'], {
  stdio: 'inherit',
});

seedProc.on('exit', (code) => {
  serverProc.kill('SIGTERM');
  process.exit(code ?? 0);
});
