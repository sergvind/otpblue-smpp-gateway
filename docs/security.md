# Security

This document describes the security measures implemented in the SMPP gateway, configuration recommendations for production deployments, and known limitations.

## Authentication

### SMPP Bind Credentials

Each client authenticates via `system_id` and `password` during the SMPP bind handshake. Passwords are verified against credentials fetched from the backend auth API and cached in memory.

- Bcrypt hashes with cost factor 10+ are supported (`$2b$` and `$2a$` prefixes)
- Plaintext passwords are supported for development but **log a warning at startup** — do not use in production
- Plaintext comparison uses `crypto.timingSafeEqual()` to prevent timing attacks
- When an unknown `system_id` is submitted, a **dummy bcrypt compare** runs to prevent timing-based enumeration of valid system IDs

**Generate a bcrypt hash:**
```bash
npx bcrypt-cli hash "your-password"
```

### IP Allowlisting

Each client can specify an `allowedIps` array. When configured, only connections from those IPs can bind with that client's credentials. IPv6-mapped IPv4 addresses (`::ffff:x.x.x.x`) are normalized automatically.

If `allowedIps` is empty or omitted, any IP can connect (restricted by password only).

## Brute-Force Protection

A global **bind rate limiter** tracks failed authentication attempts per source IP:

- After **10 failed bind attempts**, the IP is blocked for **15 minutes**
- The failure counter resets after 10 minutes of no attempts from that IP
- A successful bind clears the failure counter for that IP
- Blocked IPs receive `ESME_RBINDFAIL` immediately without touching the credential store

This prevents password-guessing attacks while allowing legitimate clients that occasionally mistype credentials.

## Connection Limits

| Protection | Default | Env Var |
|---|---|---|
| Max concurrent connections | 1000 | `SMPP_MAX_CONNECTIONS` |
| Pre-bind timeout | 30 seconds | `SMPP_PRE_BIND_TIMEOUT_S` |
| Inactivity timeout | 90 seconds | `ENQUIRE_LINK_TIMEOUT_S` |
| Max session duration | 24 hours | `SMPP_MAX_SESSION_DURATION_S` |

- **Max connections**: New TCP connections are rejected (destroyed immediately) once the limit is reached. Protects against connection-flood DoS.
- **Pre-bind timeout**: Unauthenticated sessions that don't complete the bind handshake within 30 seconds are destroyed. Prevents slowloris-style attacks.
- **Inactivity timeout**: Bound sessions that don't send `enquire_link` or `submit_sm` within the timeout are disconnected.
- **Max session duration**: Even active sessions are disconnected after 24 hours. Forces clients to re-authenticate periodically.

## Rate Limiting

Rate limiting uses a **token bucket** algorithm, configured per client via `maxTps` (messages per second).

Rate limiters are **shared across all sessions** for the same `system_id`. A client opening 10 connections still shares one rate limit, preventing bypass by opening multiple connections.

When a client exceeds their rate limit, `submit_sm` returns `ESME_RTHROTTLED` (0x58) — the standard SMPP throttling response that aggregators handle automatically with backoff.

## Input Validation

All incoming SMPP PDU fields are validated before processing:

| Field | Limit | Response on violation |
|---|---|---|
| `destination_addr` | Max 21 characters | `ESME_RINVDSTADR` |
| `short_message` | Max 512 bytes | `ESME_RINVMSGLEN` |
| Phone number format | Must pass libphonenumber validation | `ESME_RINVDSTADR` |
| OTP code extraction | Must contain 4-10 digit code | `ESME_RINVMSGLEN` |
| Custom regex patterns | Invalid patterns are skipped silently | Falls back to defaults |

Invalid phone numbers are rejected rather than forwarded to the OTP Blue API.

## TLS

The gateway supports TLS for SMPP connections on a separate port (default 2776).

### Configuration

```bash
SMPP_TLS_KEY_PATH=/certs/key.pem
SMPP_TLS_CERT_PATH=/certs/cert.pem
SMPP_ENABLE_PLAINTEXT=false   # Disable plaintext port in production
```

When TLS is enabled:
- **Minimum TLS version**: TLSv1.2 (enforced)
- A **warning is logged** if the plaintext port is also enabled alongside TLS

### Production Recommendation

Disable the plaintext SMPP port in production by setting `SMPP_ENABLE_PLAINTEXT=false`. This ensures all SMPP credentials and OTP codes are encrypted in transit.

If at least one of plaintext or TLS must be enabled — the server will refuse to start if both are disabled.

## Health & Metrics Endpoint

The health/metrics HTTP server is bound to **`127.0.0.1` by default**, making it accessible only from the local machine. This prevents external access to Prometheus metrics that contain `system_id` labels and traffic patterns.

| Env Var | Default | Description |
|---|---|---|
| `HEALTH_BIND_ADDRESS` | `127.0.0.1` | Bind address for health server |
| `HEALTH_PORT` | `8080` | Port for health server |

For Docker deployments, the `docker-compose.yml` sets `HEALTH_BIND_ADDRESS=0.0.0.0` inside the container (relying on Docker network isolation) but does **not** expose port 8080 to the host by default. Uncomment the port mapping only if your Prometheus scraper runs outside the Docker network.

## Logging & Data Protection

- **Phone numbers** are masked in all log output: `+1415555****` (last 4 digits replaced)
- **API keys** are never logged
- **OTP Blue error codes** are logged numerically; detailed error messages from the API are not included in logs
- Structured JSON logging (pino) makes it easy to forward to log aggregation systems
- Set `LOG_LEVEL=info` in production (avoid `debug` which includes more detail)

## Secrets Management

### What contains secrets

| File | Contains |
|---|---|
| `.env` | `SMPP_AUTH_API_KEY`, auth API credentials |
| `certs/*.pem` | TLS private keys |

### Protections

- `certs/` directory and `*.pem`/`*.key` files are in `.gitignore`
- `.env` is in `.gitignore`
- The Docker build uses `.dockerignore` to exclude `.env`, `certs/`, `test/`, and `.git/` from the build context
- Client credentials are never stored on disk — fetched from auth API and cached in memory only

### Recommendations

- Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, Docker secrets) for `SMPP_AUTH_API_KEY` in production
- Rotate API keys through the dashboard — no gateway restart needed (cache expires after 30 min)

## Docker Security

The Dockerfile follows security best practices:

- **Multi-stage build**: Build tools and source code are not included in the final image
- **Non-root user**: The process runs as `smpp:smpp` (UID/GID 1001)
- **Tini init**: Proper signal handling and zombie process reaping via `tini`
- **Alpine base**: Minimal attack surface with `node:20-alpine`
- **Read-only mounts**: Config and certs are mounted `ro` in docker-compose
- **`.dockerignore`**: Prevents secrets, tests, and source from leaking into Docker layers

## Known Limitations

These are understood trade-offs, not bugs:

1. **`smpp` package is a release candidate** (0.6.0-rc.4) — pinned to exact version to prevent accidental upgrades. This is the most mature Node.js SMPP server library available.

2. **No certificate pinning** for the OTP Blue API — the gateway uses standard TLS certificate validation via the system's trusted CA store. Add certificate pinning if your threat model includes compromised CAs.

3. **Rate limiting is per-instance** — if you run multiple gateway instances behind a load balancer, each instance enforces limits independently. For shared rate limiting across instances, consider adding a central store (Redis).

4. **No CIDR support in IP allowlists** — IPs must be listed individually. CIDR range support (e.g., `10.0.0.0/8`) is not currently implemented.

5. **Cache TTL delay** — after changing client credentials in the dashboard, the gateway may use the old cached credentials for up to `SMPP_AUTH_CACHE_TTL_MS` (default 30 minutes).

## Security Checklist for Production

- [ ] All client passwords are bcrypt hashes (no plaintext)
- [ ] TLS is enabled (`SMPP_TLS_KEY_PATH` and `SMPP_TLS_CERT_PATH` set)
- [ ] Plaintext SMPP port is disabled (`SMPP_ENABLE_PLAINTEXT=false`)
- [ ] `SMPP_AUTH_API_KEY` is stored securely (not in source code)
- [ ] Health server is not exposed externally (bound to `127.0.0.1` or behind firewall)
- [ ] IP allowlists are configured for each client where possible
- [ ] Log level is set to `info` (not `debug`)
- [ ] Connection limits are tuned for expected traffic (`SMPP_MAX_CONNECTIONS`)
- [ ] Docker container runs as non-root (default in provided Dockerfile)
- [ ] TLS certificates are rotated before expiry
