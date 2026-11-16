import http from 'node:http';
import { handleApiRequest } from './lib/api-handler.mjs';

const PORT = Number(process.env.PORT) || 8787;

http
  .createServer((req, res) => handleApiRequest(req, res))
  .listen(PORT, () => console.log(`DoubtDesk API on http://localhost:${PORT}`));
