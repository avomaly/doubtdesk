import { handleApiRequest } from '../lib/api-handler.mjs';

export default function login(req, res) {
  return handleApiRequest(req, res, '/api/login');
}
