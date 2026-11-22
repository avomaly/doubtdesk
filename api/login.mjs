import { handleApiRequest } from '../lib/api-handler.mjs';

export const config = { maxDuration: 30 };

export default function login(req, res) {
  return handleApiRequest(req, res, '/api/login');
}
