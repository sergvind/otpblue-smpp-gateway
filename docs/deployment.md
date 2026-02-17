# Deployment Guide

## Prerequisites

- Node.js 20+ (or Docker)
- An OTP Blue API key (obtain from your OTP Blue account)

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
cp .env.example .env
# Edit .env — set SMPP_AUTH_API_URL and SMPP_AUTH_API_KEY

# 3. Start the connector
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
| `SMPP_AUTH_API_URL` | — | Backend auth API URL for client credentials |
| `SMPP_AUTH_API_KEY` | — | Authorization header value for auth API |
| `SMPP_AUTH_CACHE_TTL_MS` | `1800000` | How long to cache client credentials (default: 30 min) |
| `HEALTH_PORT` | `8080` | Health/metrics HTTP server port |
| `LOG_LEVEL` | `info` | Log level: trace, debug, info, warn, error, fatal |

### Client Authentication

Client credentials are fetched on-demand from the backend auth API:

```
GET {SMPP_AUTH_API_URL}/imsg/api/v1/smpp/auth/?system_id={system_id}
Authorization: {SMPP_AUTH_API_KEY}
```

The API returns a client configuration object:

```json
{
  "systemId": "acme_otp",
  "password": "plaintext-or-bcrypt-hash",
  "apiKey": "otpblue-api-key",
  "defaultSender": "Acme",
  "defaultLanguage": "en",
  "maxTps": 50,
  "allowedIps": [],
  "enabled": true,
  "failureMode": "immediate"
}
```

Responses are cached in memory for `SMPP_AUTH_CACHE_TTL_MS` (default 30 minutes). When the API is unavailable, stale cached credentials are used as fallback.

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
  -e SMPP_AUTH_API_URL=https://your-backend.example.com \
  -e SMPP_AUTH_API_KEY=your-auth-api-key \
  -e LOG_LEVEL=info \
  smpp-otpblue-connector
```

### Docker Compose

```bash
# Set auth API credentials in .env or docker-compose.yml
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

## Production Deployment (DigitalOcean)

This section covers deploying to a DigitalOcean Droplet with Let's Encrypt TLS and Prometheus + Grafana monitoring.

### 1. Droplet Prerequisites

On a fresh Ubuntu 22.04+ Droplet:

```bash
# Install Docker
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# Install certbot
snap install --classic certbot
ln -s /snap/bin/certbot /usr/bin/certbot
```

### 2. Firewall

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # Certbot ACME challenges
ufw allow 2775/tcp   # SMPP plaintext
ufw allow 2776/tcp   # SMPP TLS
ufw allow 3000/tcp   # Grafana
ufw enable
```

Ports 8080 (health) and 9090 (Prometheus) stay internal to Docker — not exposed to the internet.

### 3. TLS with Let's Encrypt

Point your domain's DNS A record to the Droplet IP, then:

```bash
certbot certonly --standalone -d smpp.yourdomain.com \
  --non-interactive --agree-tos --email you@example.com
```

Fix permissions so the container (UID 1001) can read the private key:

```bash
chmod 0755 /etc/letsencrypt/{archive,live}
chmod 0755 /etc/letsencrypt/archive/smpp.yourdomain.com
chmod 0755 /etc/letsencrypt/live/smpp.yourdomain.com
chmod 0644 /etc/letsencrypt/archive/smpp.yourdomain.com/privkey*.pem
```

Set up auto-renewal with a deploy hook to restart the container (certs are read at startup):

```bash
cat > /etc/letsencrypt/renewal-hooks/deploy/smpp-restart.sh << 'EOF'
#!/bin/bash
chmod 0644 /etc/letsencrypt/archive/smpp.yourdomain.com/privkey*.pem
cd /opt/smpp-gateway
docker compose restart smpp-connector
logger "SMPP connector restarted after TLS cert renewal"
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/smpp-restart.sh
```

Certbot's snap timer handles renewal checks automatically (twice daily).

### 4. Deploy

```bash
git clone <repo-url> /opt/smpp-gateway
cd /opt/smpp-gateway

# Environment
cat > .env << 'EOF'
DOMAIN=smpp.yourdomain.com
SMPP_AUTH_API_URL=https://your-backend.example.com
SMPP_AUTH_API_KEY=your-auth-api-key
GRAFANA_ADMIN_PASSWORD=<strong-random-password>
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
EOF
chmod 600 .env

# Build and start
docker compose build
docker compose up -d
```

The `COMPOSE_FILE` variable lets `docker compose` automatically use both files.

### 5. Verify

```bash
# Health (from the Droplet)
docker compose exec smpp-connector wget -qO- http://localhost:8080/health
# → {"status":"ok"}

# TLS certificate
openssl s_client -connect smpp.yourdomain.com:2776 </dev/null 2>/dev/null | head -5

# SMPP port
nc -zv smpp.yourdomain.com 2775

# Prometheus targets
docker compose exec prometheus wget -qO- http://localhost:9090/api/v1/targets

# Grafana — open http://smpp.yourdomain.com:3000
# Login: admin / <GRAFANA_ADMIN_PASSWORD>
# Query: up{job="smpp-connector"} should return 1
```

### 6. Updates

```bash
cd /opt/smpp-gateway
git pull
docker compose build smpp-connector
docker compose up -d smpp-connector
```

Client credentials are fetched from the auth API on each bind and cached in memory (30 min default). No restart needed when managing clients through the dashboard.

### Network Architecture

```
Internet → UFW Firewall → Docker
  :2775 ──────► smpp-connector :2775 (SMPP plaintext)
  :2776 ──────► smpp-connector :2776 (SMPP TLS)
  :3000 ──────► grafana :3000

Docker internal (monitoring network):
  prometheus :9090 ──scrapes──► smpp-connector :8080/metrics
  grafana ──queries──► prometheus :9090
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
