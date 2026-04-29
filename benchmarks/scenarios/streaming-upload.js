'use strict';

module.exports = {
  name: 'streaming-upload',
  path: '/hash-body',
  wrk: {
    script: 'post-hash-body.lua',
    connections: 25,
  },
  setup(app, framework) {
    const crypto = require('crypto');

    function createHashFromRequest(req, callback) {
      const hash = crypto.createHash('sha256');
      req.on('data', (chunk) => {
        hash.update(chunk);
      });
      req.on('end', () => {
        callback(hash.digest('hex'), null);
      });
      req.on('error', (error) => {
        callback(null, error);
      });
    }

    if (framework === 'fastify') {
      // Register no-op content type parser for application/octet-stream
      // This prevents Fastify from rejecting with 415 Unsupported Media Type
      // Without parseAs, Fastify doesn't buffer the stream (bodyLimit doesn't apply)
      app.addContentTypeParser('application/octet-stream', function (_request, _payload, done) {
        done();
      });

      app.post('/hash-body', (req, reply) => {
        createHashFromRequest(req.raw, (digest, error) => {
          if (error) {
            reply.code(500).send({ error: error.message });
            return;
          }
          reply.type('text/plain').send(digest);
        });
      });
    } else {
      // Express and uWestJS use same API
      app.post('/hash-body', (req, res) => {
        createHashFromRequest(req, (digest, error) => {
          if (error) {
            res.status(500).type('text/plain').send('Error processing upload');
            return;
          }
          res.type('text/plain').send(digest);
        });
      });
    }
  },
};
