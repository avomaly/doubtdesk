import { handleApiRequest } from '../../lib/api-handler.mjs';

export const config = { maxDuration: 30 };

export default function createRoom(req, res) {
  return handleApiRequest(req, res, '/api/rooms/create');
}
