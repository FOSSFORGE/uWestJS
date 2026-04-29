'use strict';

const { Readable } = require('stream');

module.exports = {
  name: 'streaming-with-content-length',
  path: '/stream-with-content-length',
  wrk: {
    connections: 20,
  },
  setup(app, framework) {
    const STREAM_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
    const STREAM_CHUNK_SIZE = 64 * 1024; // 64KB
    const STREAM_CHUNK = Buffer.alloc(STREAM_CHUNK_SIZE, 'x');

    function createStream() {
      let remaining = STREAM_SIZE_BYTES;
      return new Readable({
        read() {
          if (remaining <= 0) {
            this.push(null);
            return;
          }

          const chunk =
            remaining >= STREAM_CHUNK_SIZE ? STREAM_CHUNK : STREAM_CHUNK.subarray(0, remaining);
          remaining -= chunk.length;
          this.push(chunk);
        },
      });
    }

    if (framework === 'fastify') {
      app.get('/stream-with-content-length', (_req, reply) => {
        reply.header('Content-Length', String(STREAM_SIZE_BYTES));
        reply.header('Content-Type', 'application/octet-stream');
        const stream = createStream();
        reply.send(stream);
      });
    } else if (framework === 'express') {
      app.get('/stream-with-content-length', (_req, res) => {
        res.setHeader('Content-Length', String(STREAM_SIZE_BYTES));
        res.setHeader('Content-Type', 'application/octet-stream');
        const stream = createStream();
        stream.pipe(res);
      });
    } else if (framework === 'uwestjs') {
      app.get('/stream-with-content-length', async (_req, res) => {
        res.setHeader('Content-Type', 'application/octet-stream');
        const stream = createStream();
        await res.stream(stream, STREAM_SIZE_BYTES);
      });
    }
  },
};
