const app = require('../server');

module.exports = (req, res) => {
  // Restore original URL if Vercel internal rewrite rewrote it to /api/index.js
  const matched = req.headers['x-matched-path'] || req.headers['x-vercel-matched-path'];
  if (matched && (req.url === '/api/index.js' || req.url.startsWith('/api/index.js'))) {
    req.url = matched;
  }
  return app(req, res);
};
