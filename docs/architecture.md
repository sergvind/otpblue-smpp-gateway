# Architecture

## Overview

The SMPP-to-REST Connector is a protocol bridge that presents itself as an SMSC (Short Message Service Center) to SMS aggregator clients over SMPP, and translates their OTP messages into OTP Blue REST API calls for delivery via iMessage.

```
Aggregator Clients                    Connector                         OTP Blue
┌──────────────┐                ┌─────────────────────┐
│  Client A    │──┐             │                     │
│  (SMPP TRX)  │  │             │  SMPP Server        │          ┌──────────────┐
└──────────────┘  │  TCP/TLS    │  (port 2775/2776)   │  HTTPS   │              │
┌──────────────┐  ├────────────>│                     │─────────>│  REST API    │
│  Client B    │──┤             │  Auth → Parse →     │          │  v1.1        │
│  (SMPP TRX)  │  │             │  Call API → Respond │<─────────│              │
└──────────────┘  │             │  → Delivery Receipt │          └──────────────┘
┌──────────────┐  │             │                     │
│  Client C    │──┘             │  Health/Metrics     │
│  (SMPP TRX)  │                │  (port 8080)        │
└──────────────┘                └─────────────────────┘
```

## How It Works

OTP Blue's REST API is **synchronous** — it returns `delivered` or `failed` immediately. This is faster than standard SMS routes, where delivery status arrives seconds or minutes later via a delivery receipt. The connector exploits this to provide instant feedback to aggregators.

### Message Flow

```
1. Aggregator sends submit_sm
   └── Contains: destination phone, sender ID, full message text

2. Connector processes
   ├── Rate limit check (per-client token bucket)
   ├── Normalize phone number to E.164 format
   ├── Extract OTP code from message text via regex
   ├── Resolve sender name from SMPP source_addr (alpha name)
   ├── Resolve template language from client config or destination country
   └── POST to OTP Blue API with mapped API key

3. Connector responds
   ├── Success: submit_sm_resp (ESME_ROK) + deliver_sm (stat:DELIVRD)
   └── Failure: submit_sm_resp with SMPP error status
       └── Aggregator immediately failovers to a regular SMS route
```

### Why Instant Errors Matter

The most common failure is error 150 ("no iMessage") — 50-98% of traffic depending on destination country. When this happens, the connector returns an SMPP error in `submit_sm_resp` immediately. The aggregator's routing engine treats this like any standard route failure and failovers to SMS within milliseconds. This is the standard pattern aggregators already implement.

## Module Architecture

```
src/
├── index.ts                         Entry point
│
├── config/
│   ├── index.ts                     Loads env vars + clients.json, validates with Zod
│   └── schema.ts                    Zod schemas for configuration
│
├── smpp/
│   ├── server.ts                    Creates SMPP server (plain + TLS), manages sessions
│   ├── session-handler.ts           Per-session lifecycle — THE CORE MODULE
│   └── types.d.ts                   TypeScript declarations for the `smpp` npm package
│
├── protocol/
│   ├── message-parser.ts            Extracts OTP code from full message text
│   ├── address-normalizer.ts        SMPP address (TON/NPI) → E.164; language resolution
│   ├── error-mapper.ts              OTP Blue error codes ↔ SMPP status codes
│   └── delivery-receipt.ts          Builds deliver_sm PDUs for delivery receipts
│
├── api/
│   └── otpblue-client.ts            HTTP client for OTP Blue REST API v1.1
│
├── auth/
│   └── credential-store.ts          system_id/password → API key mapping
│
├── monitoring/
│   ├── health.ts                    HTTP server for /health, /ready, /metrics
│   ├── metrics.ts                   Prometheus counters, histograms, gauges
│   └── logger.ts                    Structured JSON logging (pino)
│
└── utils/
    ├── rate-limiter.ts              Token bucket rate limiter (per client)
    └── id-generator.ts              UUID message ID generation
```

### Core Module: session-handler.ts

This is the heart of the connector. For each SMPP session, it:

1. **Handles bind** — Authenticates the client via `credential-store` (system_id + password → API key lookup). Supports `bind_transceiver`, `bind_transmitter`, and `bind_receiver`.

2. **Handles submit_sm** — The main message processing pipeline:
   - Rate limit check → `ESME_RTHROTTLED` if exceeded
   - Phone number normalization via `address-normalizer`
   - OTP code extraction via `message-parser`
   - Sender resolution from `source_addr` (alphanumeric) or client config default
   - Language resolution from client config or destination country
   - HTTP POST to OTP Blue API via `otpblue-client`
   - Response mapping via `error-mapper`
   - Delivery receipt construction via `delivery-receipt`

3. **Handles enquire_link** — Keepalive responses + inactivity timeout tracking

4. **Handles unbind** — Graceful session teardown

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| OTP code extraction | Regex from full message text | Aggregators always send full message; OTP Blue uses its own iMessage template |
| Sender name | From SMPP `source_addr` (TON=5 alphanumeric) | Maps directly to OTP Blue's bold subject line in iMessage |
| Error 150 handling | Return SMPP error immediately | Aggregators prefer synchronous errors for fast failover to SMS |
| Delivery receipts | Sent immediately after API response | OTP Blue API is synchronous — we know the final status right away |
| Rate limiting | Per-client token bucket | Returns standard `ESME_RTHROTTLED` that aggregators already handle |
| Password storage | bcrypt hashes (plaintext supported for dev) | Industry standard; prevents config file exposure |
| HTTP retries | None | Retrying could cause duplicate OTP deliveries |

## Error Mapping

| OTP Blue Error | SMPP Status | Aggregator Behavior |
|---|---|---|
| Success | `ESME_ROK` (0x00) | Message delivered via iMessage |
| 150 — No iMessage | `ESME_RSUBMITFAIL` (0x45) | Failover to SMS route |
| 720 — No capacity | `ESME_RTHROTTLED` (0x58) | Retry later or failover |
| 1600/1800/1900 — Bad number | `ESME_RINVDSTADR` (0x0B) | Drop |
| 100/110 — Internal error | `ESME_RSYSERR` (0x08) | Retry or failover |

Configurable per client: `failureMode: "immediate"` (default — error in submit_sm_resp) or `"receipt_only"` (ESME_ROK always, failure via delivery receipt only).

## Technology Stack

- **Runtime**: Node.js + TypeScript
- **SMPP**: `node-smpp` (npm: `smpp`) — MIT license, SMPP v3.3/3.4/5.0, server mode, TLS
- **HTTP**: axios
- **Validation**: Zod
- **Logging**: pino (structured JSON)
- **Metrics**: prom-client (Prometheus)
- **Phone numbers**: google-libphonenumber
- **Auth**: bcrypt
- **Testing**: vitest + nock
