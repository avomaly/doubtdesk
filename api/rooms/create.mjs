import { handleApiRequest } from '../../lib/api-handler.mjs';

export default function createRoom(req, res) {
  return handleApiRequest(req, res, '/api/rooms/create');
}
