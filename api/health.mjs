import { handleApiRequest } from '../lib/api-handler.mjs';

export default function health(req, res) {
  return handleApiRequest(req, res, '/api/health');
}
