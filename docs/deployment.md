# Deployment Guide

## Prerequisites

- Node.js 20+ (or Docker)
- An OTP Blue API key (obtain from your OTP Blue account)

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Create client configuration
cp config/clients.example.json config/clients.json
# Edit config/clients.json with your OTP Blue API key and client credentials

# 3. Set environment variables (optional — defaults work for development)
cp .env.example .env

# 4. Start the connector
npm run dev
```

The SMPP server will listen on port 2775 (plaintext) and the health server on port 8080.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SMPP_PORT` | `2775` | SMPP plaintext port |
| `SMPP_TLS_PORT` | `2776` | SMPP TLS port |
| `SMPP_TLS_KEY_PATH` | — | Path to TLS private key (enables TLS server) |
| `SMPP_TLS_CERT_PATH` | — | Path to TLS certificate (enables TLS server) |
| `ENQUIRE_LINK_TIMEOUT_S` | `90` | Disconnect idle sessions after this many seconds |
| `SHUTDOWN_GRACE_PERIOD_S` | `5` | Seconds to wait for sessions to close on shutdown |
| `OTPBLUE_API_URL` | `https://api.otpblue.com/imsg/api/v1.1/otp/send/` | OTP Blue API endpoint |
| `OTPBLUE_API_TIMEOUT_MS` | `15000` | HTTP timeout for OTP Blue API calls |
| `CLIENT_CONFIG_PATH` | `config/clients.json` | Path to client credentials file |
| `HEALTH_PORT` | `8080` | Health/metrics HTTP server port |
| `LOG_LEVEL` | `info` | Log level: trace, debug, info, warn, error, fatal |

### Client Configuration (clients.json)

Each SMS aggregator client is defined in the `clients` array:

```json
{
  "clients": [
    {
      "systemId": "acme_otp",
      "password": "$2b$10$...",
      "apiKey": "your-otpblue-api-key",
      "defaultSender": "Acme",
      "defaultLanguage": "en",
      "maxTps": 50,
      "codePatterns": [],
      "allowedIps": [],
      "enabled": true,
      "failureMode": "immediate"
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `systemId` | Yes | SMPP system_id for bind authentication (max 16 chars) |
| `password` | Yes | SMPP password — bcrypt hash or plaintext (for dev only) |
| `apiKey` | Yes | OTP Blue API key for this client's traffic |
| `defaultSender` | No | Fallback sender name when source_addr is a phone number |
| `defaultLanguage` | No | Template language code (default: `en`) |
| `maxTps` | No | Max messages per second for this client (default: 50) |
| `codePatterns` | No | Custom regex patterns for OTP code extraction |
| `allowedIps` | No | IP whitelist for extra security (empty = allow all) |
| `enabled` | No | Set to `false` to disable a client without removing config |
| `failureMode` | No | `"immediate"` (default) or `"receipt_only"` |

#### Generating a bcrypt password hash

```bash
# Using Node.js
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('mypassword', 10).then(h => console.log(h))"

# Or use an online bcrypt generator for testing
```

## Docker Deployment

### Build and Run

```bash
# Build the Docker image
docker build -t smpp-otpblue-connector .

# Run with configuration
docker run -d \
  --name smpp-connector \
  -p 2775:2775 \
  -p 2776:2776 \
  -p 8080:8080 \
  -v $(pwd)/config:/config:ro \
  -e CLIENT_CONFIG_PATH=/config/clients.json \
  -e LOG_LEVEL=info \
  smpp-otpblue-connector
```

### Docker Compose

```bash
# Create your client config
cp config/clients.example.json config/clients.json
# Edit config/clients.json

# Start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

### TLS Setup

To enable SMPP over TLS (port 2776):

1. Place your TLS certificate and private key files:
   ```
   certs/
   ├── cert.pem
   └── key.pem
   ```

2. Set environment variables:
   ```
   SMPP_TLS_KEY_PATH=/certs/key.pem
   SMPP_TLS_CERT_PATH=/certs/cert.pem
   ```

3. Mount the certs directory in Docker:
   ```yaml
   volumes:
     - ./certs:/certs:ro
   ```

Clients connect to port 2776 for TLS or port 2775 for plaintext.

## Health Checks and Monitoring

### Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Always returns 200 if the process is running |
| `GET /ready` | Returns 200 when the SMPP server is accepting connections |
| `GET /metrics` | Prometheus-format metrics |

### Key Metrics

| Metric | Type | Description |
|---|---|---|
| `smpp_connections_total` | Counter | Total connections by system_id and status |
| `smpp_active_connections` | Gauge | Currently active connections |
| `submit_sm_received_total` | Counter | Total submit_sm PDUs received |
| `submit_sm_success_total` | Counter | Successful iMessage deliveries |
| `submit_sm_failed_total` | Counter | Failed deliveries by error code |
| `submit_sm_throttled_total` | Counter | Rate-limited requests |
| `otpblue_api_latency_seconds` | Histogram | API call latency distribution |

### Prometheus Scrape Config

```yaml
scrape_configs:
  - job_name: 'smpp-connector'
    scrape_interval: 15s
    static_configs:
      - targets: ['smpp-connector:8080']
```

## Production Considerations

### Network

- **Ports**: Open 2775 (SMPP) and/or 2776 (SMPP TLS) for aggregator clients. Port 8080 should only be accessible internally (health checks, Prometheus).
- **Firewall**: Use the `allowedIps` client config to restrict which IPs can bind.
- **TLS**: Strongly recommended for production. Aggregators should connect on port 2776.

### Scaling

- The connector is stateless (no persistent storage). You can run multiple instances behind a TCP load balancer.
- Each instance handles multiple concurrent SMPP sessions.
- Rate limiting is per-instance, per-client. If running N instances, set `maxTps` to `desired_total_tps / N`.

### Logging

- Logs are structured JSON (pino) for easy ingestion into log aggregation systems (ELK, Datadog, etc.).
- Phone numbers are automatically masked in logs (`+1415555****`).
- API keys are never logged.
- Set `LOG_LEVEL=debug` for troubleshooting, `LOG_LEVEL=info` for production.

### Graceful Shutdown

On `SIGTERM` or `SIGINT`, the connector:
1. Stops accepting new connections
2. Sends `unbind` to all active sessions
3. Waits `SHUTDOWN_GRACE_PERIOD_S` seconds for clients to close
4. Force-closes remaining sessions
5. Exits

This ensures zero message loss during deployments.
