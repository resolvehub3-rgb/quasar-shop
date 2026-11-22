import app from '../dist-server/server.js';

export default function handler(req, res) {
  return app(req, res);
}
