import http from 'node:http';
import { metricsRegistry } from './metrics.js';
import { logger } from './logger.js';

let isReady = false;

export function setReady(ready: boolean): void {
  isReady = ready;
}

export function startHealthServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.url === '/ready') {
      const code = isReady ? 200 : 503;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: isReady }));
      return;
    }

    if (req.url === '/metrics') {
      try {
        const metrics = await metricsRegistry.metrics();
        res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end('Error collecting metrics');
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, () => {
    logger.info({ port }, 'Health/metrics server listening');
  });

  return server;
}
