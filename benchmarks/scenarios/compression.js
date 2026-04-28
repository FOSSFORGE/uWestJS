'use strict';

module.exports = {
  name: 'compression',
  path: '/compress',
  wrk: {
    script: 'compression.lua',
    connections: 100,
  },
  async setup(app, framework) {
    const payload = 'This is compressible text content. '.repeat(2400);
    const body = Buffer.from(payload, 'utf8');

    if (framework === 'express') {
      const compression = require('compression');
      app.use(compression());
      app.get('/compress', (_req, res) => {
        res.type('text/plain').send(body);
      });
    } else if (framework === 'fastify') {
      await app.register(require('@fastify/compress'), { threshold: 1024 });
      app.get('/compress', (_req, reply) => {
        reply.type('text/plain').send(body);
      });
    } else if (framework === 'uwestjs') {
      const { CompressionHandler } = require('../../dist/index');
      const handler = new CompressionHandler({ threshold: 1024 });

      app.get('/compress', async (req, res) => {
        try {
          res.setHeader('content-type', 'text/plain');
          const compressed = await handler.compressBuffer(req, res, body);
          res.send(compressed);
        } catch {
          res.status(500).send('compression error');
        }
      });
    }
  },
};
