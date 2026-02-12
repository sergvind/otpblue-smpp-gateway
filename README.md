# OTP Blue SMPP Gateway

SMPP v3.4 gateway that enables SMS aggregators to route OTP traffic to [OTP Blue](https://otpblue.com) for delivery via iMessage — using the same SMPP protocol they already use for SMS carriers.

## How It Works

```
SMS Aggregator  ──SMPP──►  Gateway  ──HTTPS──►  OTP Blue API  ──iMessage──►  iPhone
```

The gateway accepts standard SMPP `submit_sm` PDUs, extracts the OTP code from the message text, and calls the OTP Blue REST API. Delivery status is returned **synchronously** — faster than SMS, enabling instant failover when the recipient doesn't have iMessage.

## Key Features

- **Standard SMPP v3.4** — aggregators connect the same way they connect to any SMS carrier
- **Instant delivery status** — know if the message was delivered immediately (no async DLR wait)
- **Instant failover** — if the recipient doesn't have iMessage, get an error response immediately so you can failover to SMS without delay
- **Sender name support** — SMPP alphanumeric sender ID maps to iMessage bold subject line
- **Per-client configuration** — separate API keys, rate limits, IP whitelists, and OTP extraction patterns
- **TLS support** — plaintext (2775) and TLS (2776) SMPP ports
- **Prometheus metrics** — connections, message counts, API latency, error rates
- **Docker ready** — multi-stage build, non-root user

## Quick Start

```bash
# Install dependencies
npm install

# Create client configuration
cp config/clients.example.json config/clients.json
# Edit config/clients.json with your OTP Blue API key and client credentials

# Start the gateway
npm run dev
```

The SMPP server listens on port 2775 and the health server on port 8080.

## Docker

```bash
cp config/clients.example.json config/clients.json
# Edit config/clients.json

docker compose up -d
```

## Configuration

Client configuration in `config/clients.json`:

```json
{
  "clients": [
    {
      "systemId": "acme_otp",
      "password": "$2b$10$... (bcrypt hash)",
      "apiKey": "your-otpblue-api-key",
      "defaultSender": "Acme",
      "defaultLanguage": "en",
      "maxTps": 50
    }
  ]
}
```

See [Deployment Guide](docs/deployment.md) for all environment variables and configuration options.

## Documentation

- [Architecture](docs/architecture.md) — module structure, data flow, design decisions
- [Deployment Guide](docs/deployment.md) — setup, environment variables, Docker, TLS, monitoring
- [Integration Guide](docs/integration-guide.md) — for SMS aggregators: connection details, message format, error codes, failover setup

## Message Flow

1. Aggregator sends `submit_sm` with destination phone and full OTP message text
2. Gateway extracts the OTP code via regex, normalizes the phone number to E.164
3. Gateway calls the OTP Blue API with the client's mapped API key
4. On success: `submit_sm_resp` (ESME_ROK) + delivery receipt (stat:DELIVRD)
5. On failure: `submit_sm_resp` with SMPP error → aggregator failovers to SMS

## Error Handling

| Scenario | SMPP Response | Aggregator Action |
|---|---|---|
| Delivered via iMessage | `ESME_ROK` (0x00) | Done |
| No iMessage | `ESME_RSUBMITFAIL` (0x45) | Failover to SMS |
| Rate limited | `ESME_RTHROTTLED` (0x58) | Retry with backoff |
| Invalid number | `ESME_RINVDSTADR` (0x0B) | Drop |
| System error | `ESME_RSYSERR` (0x08) | Retry or failover |

## Testing

```bash
npm test
```

## License

MIT
