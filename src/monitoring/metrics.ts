import client from 'prom-client';

// Collect default Node.js metrics (GC, event loop, memory)
client.collectDefaultMetrics();

export const smppConnectionsTotal = new client.Counter({
  name: 'smpp_connections_total',
  help: 'Total SMPP connections received',
  labelNames: ['system_id', 'status'] as const,
});

export const smppActiveConnections = new client.Gauge({
  name: 'smpp_active_connections',
  help: 'Currently active SMPP connections',
  labelNames: ['system_id'] as const,
});

export const submitSmReceived = new client.Counter({
  name: 'submit_sm_received_total',
  help: 'Total submit_sm PDUs received',
  labelNames: ['system_id'] as const,
});

export const submitSmSuccess = new client.Counter({
  name: 'submit_sm_success_total',
  help: 'Total successful submit_sm (delivered via iMessage)',
  labelNames: ['system_id'] as const,
});

export const submitSmFailed = new client.Counter({
  name: 'submit_sm_failed_total',
  help: 'Total failed submit_sm',
  labelNames: ['system_id', 'error_code'] as const,
});

export const submitSmThrottled = new client.Counter({
  name: 'submit_sm_throttled_total',
  help: 'Total submit_sm throttled (rate limited)',
  labelNames: ['system_id'] as const,
});

export const otpblueApiLatency = new client.Histogram({
  name: 'otpblue_api_latency_seconds',
  help: 'OTP Blue API call latency in seconds',
  labelNames: ['system_id', 'status'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
});

export const metricsRegistry = client.register;
