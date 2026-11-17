import http from 'node:http';
import { handleApiRequest } from './lib/api-handler.mjs';

const PORT = Number(process.env.PORT) || 8787;

const server = http.createServer((req, res) => handleApiRequest(req, res));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Terminate the other process or set PORT.`);
    process.exit(1);
  }
  console.error('DoubtDesk server error:', err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => console.log(`DoubtDesk API on http://127.0.0.1:${PORT}`));
