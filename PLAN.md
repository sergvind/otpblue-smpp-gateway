# SMPP-to-REST Connector for OTP Blue

## Context

OTP Blue delivers OTP codes via iMessage. Clients are SMS aggregators who route OTP traffic to OTP Blue via its REST API. However, many aggregators use the SMPP protocol as their default way to route traffic to different channels. To support these clients natively, we need an **SMPP server** that accepts SMPP connections from aggregators, translates `submit_sm` PDUs into OTP Blue REST API calls, and returns delivery status back through SMPP.

---

## Background: How SMPP Works in the SMS Industry

### The SMS OTP Delivery Chain
```
Application  -->  SMS Aggregator  --SMPP-->  Carrier/Channel  --deliver-->  Mobile Device
                  (our client)               (OTP Blue = here)              (iMessage)
```

Aggregators connect to carriers and channel providers via persistent SMPP sessions. They send `submit_sm` PDUs containing the **full message text** and destination phone number, and receive `submit_sm_resp` (acknowledgment) and `deliver_sm` (delivery receipts) back.

### SMPP Protocol Essentials (v3.4 -- industry standard)
- **Binary protocol over TCP**, ports 2775 (plain) / 2776 (TLS)
- **Bind modes**: Transceiver (TRX) is the modern standard -- bidirectional on one connection
- **Session lifecycle**: `bind_transceiver` → exchange PDUs → `unbind`
- **Key PDUs**: `submit_sm` (send message), `submit_sm_resp` (ack with message_id), `deliver_sm` (delivery receipt), `enquire_link` (keepalive every 30-60s)
- **Auth**: `system_id` + `password` during bind
- **Windowing**: Multiple in-flight PDUs matched by `sequence_number` for throughput
- **Addresses**: Phone numbers with TON/NPI (Type of Number / Numbering Plan Indicator)
- **Delivery receipts**: Sent as `deliver_sm` with `esm_class=0x04`, containing status like `DELIVRD` or `UNDELIV`

### How Aggregators Send OTP Messages via SMPP

**The `short_message` field always contains the full human-readable message text.** This is universal practice -- SMPP is a transport protocol and aggregators forward the message verbatim as composed by their end-application client:

```
source_addr_ton: 0x05 (Alphanumeric)
source_addr: "MyBank"
destination_addr: "14155551234"
short_message: "Your verification code is 482910. Do not share this code."
```

The aggregator never sends just the OTP code in isolation -- the full contextual message is always present.

### Why Aggregators Want SMPP
- It's their default protocol -- they already have SMPP client infrastructure
- Low latency (persistent TCP, binary framing, no HTTP overhead)
- Adding a new SMPP route is operationally simpler than integrating a new REST API
- Standard delivery receipt mechanism they already process
- Asynchronous windowing for high throughput

---

## Compatibility: Can OTP Blue Be a "Transparent SMS Route"?

**Yes -- and it's actually faster than a standard SMS route.** Here's why:

### Standard SMS route behavior:
```
submit_sm  →  SMSC accepts  →  submit_sm_resp (ESME_ROK, message accepted)
                                    ... seconds to minutes pass ...
                              →  deliver_sm (stat:DELIVRD or stat:UNDELIV)
```
The `submit_sm_resp` only means "accepted into queue." The actual delivery status comes later via a delivery receipt, sometimes minutes later.

### OTP Blue's behavior (faster):
```
submit_sm  →  Instant iMessage lookup  →  submit_sm_resp
                                            ├── ESME_ROK (delivered!) + immediate DLR with stat:DELIVRD
                                            └── Error status (no iMessage) → aggregator failovers to SMS instantly
```

OTP Blue's synchronous API means we know the **final delivery status immediately**. This is strictly better for aggregators:

1. **On success**: The aggregator gets `ESME_ROK` + an immediate delivery receipt with `stat:DELIVRD`. Faster confirmation than any SMS route.

2. **On "no iMessage" (error 150)**: We return an SMPP error in `submit_sm_resp` immediately. The aggregator's routing engine treats this like any other route failure and **failovers to a regular SMS route within milliseconds**. This is the standard failover pattern -- aggregators already implement "failover on submit error."

3. **Aggregators prefer synchronous errors for failover.** Waiting for a delivery receipt (which can take 5-60+ seconds in SMS) before failing over would defeat the purpose for OTP traffic. Our instant response is exactly what they want.

### The one difference from standard SMS:
OTP Blue doesn't forward the message text verbatim -- it uses its own iMessage template with the sender name in bold and the OTP code. So we need to **extract the OTP code** from the full message text. This is the core parsing challenge (see below).

### Precedent:
Multiple aggregators (Infobip, Sinch, Route Mobile) already offer SMPP interfaces for non-SMS channels (WhatsApp, RCS, Viber). The pattern of accepting standard SMPP and internally translating to a channel-specific API is well-established.

---

## Technology Choice

**Library: `node-smpp`** (npm: `smpp`, MIT license)
- Full SMPP server mode via `smpp.createServer()`
- Supports v3.3/3.4/5.0, TLS, TLV parameters
- Small codebase (~2,500 lines), easy to extend and maintain
- The SMPP v3.4 spec hasn't changed since 1999 -- feature-completeness matters more than recent commits

**Runtime: Node.js + TypeScript**
- Natural fit for the event-driven, I/O-bound proxy pattern
- Rich HTTP client ecosystem for calling OTP Blue's REST API

**Alternatives considered and rejected:**
- Jasmin SMS Gateway (Python) -- full gateway with RabbitMQ+Redis overhead, overkill for a proxy
- Java (Cloudhopper/jSMPP) -- aging codebases, JVM overhead not justified
- Go -- no mature server-mode library available
- Rust -- alpha-stage libraries only

---

## Architecture

```
                    Aggregator Clients
                    ┌──────────────┐
                    │  Client A    │──┐
                    │  (SMPP TRX)  │  │
                    └──────────────┘  │
                    ┌──────────────┐  │    ┌─────────────────────────────────┐
                    │  Client B    │──┼───>│  SMPP-to-REST Connector         │
                    │  (SMPP TRX)  │  │    │                                 │
                    └──────────────┘  │    │  ┌───────────────────────────┐  │     ┌──────────────┐
                    ┌──────────────┐  │    │  │ SMPP Server (2775/2776)  │  │     │              │
                    │  Client C    │──┘    │  │                         │  │────>│  OTP Blue    │
                    │  (SMPP TRX)  │       │  │  Auth → Parse → Call ───┼──│     │  REST API    │
                    └──────────────┘       │  │  API → Respond → DLR   │  │<────│  v1.1        │
                                          │  └───────────────────────────┘  │     │              │
                                          │                                 │     └──────────────┘
                                          │  ┌───────────────────────────┐  │
                                          │  │ Health/Metrics (8080)     │  │
                                          │  └───────────────────────────┘  │
                                          └─────────────────────────────────┘
```

### Data Flow for Each Message

```
1. Client sends submit_sm (destination phone, sender ID, full message text)
2. Rate limit check → ESME_RTHROTTLED if exceeded
3. Normalize destination phone number to E.164 format
4. Extract OTP code from message text via regex
5. Resolve sender (from source_addr) and language (from client config or destination country)
6. POST to OTP Blue API v1.1 with the client's mapped API key
7. On success: submit_sm_resp (ESME_ROK + message_id) + deliver_sm (stat:DELIVRD)
8. On failure: submit_sm_resp with SMPP error status (aggregator failovers to SMS)
```

---

## Project Structure

```
smpp-otpblue-connector/
├── src/
│   ├── index.ts                      # Entry point: starts SMPP + health servers
│   ├── config/
│   │   ├── index.ts                  # Load config from env + JSON file
│   │   └── schema.ts                 # Zod validation schemas
│   ├── smpp/
│   │   ├── server.ts                 # Create SMPP server (plain + TLS)
│   │   ├── session-handler.ts        # Per-session lifecycle (bind, submit, unbind)
│   │   └── types.ts                  # Custom TypeScript declarations for `smpp` package
│   ├── protocol/
│   │   ├── message-parser.ts         # Extract OTP code from full message text
│   │   ├── address-normalizer.ts     # Convert SMPP address (TON/NPI) to E.164
│   │   ├── delivery-receipt.ts       # Build deliver_sm PDUs for delivery receipts
│   │   └── error-mapper.ts           # Map OTP Blue error codes ↔ SMPP status codes
│   ├── api/
│   │   └── otpblue-client.ts         # HTTP client for OTP Blue REST API
│   ├── auth/
│   │   └── credential-store.ts       # system_id/password → API key + client config
│   ├── monitoring/
│   │   ├── health.ts                 # HTTP health check endpoints
│   │   ├── metrics.ts                # Prometheus-style counters/gauges
│   │   └── logger.ts                 # Structured logging (pino)
│   └── utils/
│       ├── rate-limiter.ts           # Per-client token bucket
│       └── id-generator.ts           # Message ID generation
├── test/
│   ├── unit/                         # Unit tests for each protocol module
│   └── integration/                  # Full SMPP flow tests with mocked API
├── Dockerfile
├── docker-compose.yml
├── tsconfig.json
├── package.json
└── .env.example
```

---

## Key Design Decisions

### 1. Message Parsing -- Extracting OTP Code from Full Text

Aggregators send the full message text (e.g., `"Your verification code is 482910"`). OTP Blue's API needs just the `code` parameter. We need to extract the numeric OTP code from the text.

**Default approach: Regex extraction**

Since all OTP messages contain a prominent numeric code (4-10 digits), regex extraction is reliable:

```typescript
// Extraction strategy (tried in order):
1. If entire message is just digits (4-10 chars): use it as the code directly
   "482910" → code="482910"

2. If message contains keyword + digits: extract the digits after the keyword
   "Your verification code is 482910" → code="482910"
   "OTP: 482-910" → code="482910"

3. Fallback: extract the longest numeric sequence (4-10 digits)
   "Please use 482910 to login" → code="482910"
```

Default regex patterns:
```typescript
const PATTERNS = [
  /(?:code|pin|otp|token|password|verify)[:\s\-is]+(\d[\d\-\s]{2,9}\d)/i,
  /\b(\d{4,10})\b/,
];
```

Per-client customization: Clients can specify custom regex patterns in their config for edge cases.

### Sender Name (Alpha Name) → iMessage Bold Subject Line

SMPP natively supports alphanumeric sender IDs via the `source_addr` field. When `source_addr_ton=0x05` (Alphanumeric), aggregators put the enterprise's brand name there (e.g., `"MyBank"`, up to 11 chars). This maps directly to OTP Blue's `sender` parameter, which renders as **bold text in the first line** of the iMessage -- giving the recipient clear brand context.

```
SMPP submit_sm:                          OTP Blue API call:
  source_addr_ton: 0x05 (Alphanumeric)     sender: "MyBank"     → bold first line in iMessage
  source_addr: "MyBank"                    code: "482910"
  destination_addr: "14155551234"           contact: "+14155551234"
  short_message: "Your code is 482910"     language: "en"
```

**Handling different source_addr types:**
- **TON=5 (Alphanumeric)**: Use `source_addr` directly as `sender` (e.g., `"MyBank"`) -- this is the ideal case
- **TON=1 (International) or TON=3 (Short code)**: The source is a phone number or short code, not a brand name. In this case, fall back to the per-client `defaultSender` from config (e.g., the client's agreed brand name)
- **Sender length**: OTP Blue allows up to 16 chars for `sender`; SMPP alphanumeric sender IDs are typically up to 11 chars, so this fits naturally

### 2. Authentication Mapping

Each aggregator client has a config entry mapping their SMPP credentials to an OTP Blue API key:

```json
{
  "clients": [
    {
      "systemId": "acme_otp",
      "password": "$2b$10$...(bcrypt hash)",
      "apiKey": "sk-live-xxxxx",
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

- `systemId` / `password`: SMPP bind credentials (password stored as bcrypt hash)
- `apiKey`: The OTP Blue API key to use for this client's traffic
- `defaultSender`: Fallback sender/brand name when source_addr is a phone number or short code instead of an alphanumeric name
- `defaultLanguage`: Template language for OTP Blue (falls back to country detection → `"en"`)
- `maxTps`: Rate limit in messages per second
- `codePatterns`: Optional custom regex for OTP code extraction (overrides defaults)
- `allowedIps`: Optional IP whitelist for extra security
- `failureMode`: How to report failures (see Error Handling below)

### 3. Error Handling -- Instant Failover Support

OTP Blue's most frequent error is `150` (no iMessage, 50-98% of traffic depending on country). Aggregators need to get this error **instantly** so they can failover to regular SMS.

**Default behavior (`failureMode: "immediate"`):** Return the error directly in `submit_sm_resp`:

| OTP Blue Error | SMPP Status | Aggregator Action |
|---|---|---|
| (success) | `ESME_ROK` (0x00) + DLR `DELIVRD` | Message delivered via iMessage |
| 150 (no iMessage) | `ESME_RDELIVERYFAILURE` (0xFE) | Failover to SMS route instantly |
| 720 (no capacity) | `ESME_RTHROTTLED` (0x58) | Retry later or failover |
| 1600/1800/1900 (bad number) | `ESME_RINVDSTADR` (0x0B) | Drop / alert |
| 100/110 (internal) | `ESME_RSYSERR` (0x08) | Retry or failover |

This is the standard SMPP pattern. Aggregators already implement "failover on submit_sm_resp error" as part of their routing logic.

**Alternative (`failureMode: "receipt_only"`):** For aggregators that prefer to always get `ESME_ROK` and receive failures only via delivery receipts -- we return `ESME_ROK` + message_id, then send `deliver_sm` with `stat:UNDELIV`. Configurable per client.

### 4. Delivery Receipts

Since OTP Blue's API is synchronous, we send delivery receipts immediately:
- `stat:DELIVRD` for successful iMessage deliveries
- `stat:UNDELIV` for failures (only in `receipt_only` mode, or as supplementary to the error status)
- Only sent if the client requested receipts (`registered_delivery` field in `submit_sm`)
- The `message_id` from OTP Blue's response is used for correlation with the `receipted_message_id` TLV

Receipt format (standard):
```
id:MESSAGE_ID sub:001 dlvrd:001 submit date:YYMMDDhhmm done date:YYMMDDhhmm stat:DELIVRD err:000 text:...
```

### 5. Address Normalization

Convert SMPP destination addresses to E.164 format using `google-libphonenumber`:
- TON=1 (International): ensure `+` prefix → validate with libphonenumber
- TON=0 (Unknown): try adding `+` prefix and parsing (aggregators often omit TON but include country code)
- TON=5 (Alphanumeric): this is the source_addr for sender names, not phone numbers
- Strip spaces, dashes, parentheses before processing

### 6. Language Resolution

OTP Blue uses language-specific templates. Resolution priority:
1. Per-client `defaultLanguage` from config
2. Derived from destination country code (using libphonenumber to detect country, then a country→language mapping covering OTP Blue's 24 supported languages)
3. Fallback: `"en"`

### 7. Rate Limiting

Per-client token bucket rate limiter:
- Each client's `maxTps` config sets their limit
- When exceeded: return `ESME_RTHROTTLED` (0x58) -- standard SMPP throttling that aggregators handle (back off + retry)
- Protects the OTP Blue API from overload

---

## Dependencies

| Package | Purpose |
|---|---|
| `smpp` | SMPP server with TLS support |
| `axios` | HTTP client for OTP Blue API |
| `pino` | Structured JSON logging |
| `zod` | Config validation at startup |
| `google-libphonenumber` | Phone number parsing + E.164 normalization |
| `bcrypt` | Password hash verification |
| `prom-client` | Prometheus metrics |
| `dotenv` | Environment variable loading |
| `vitest` | Test framework (dev) |
| `nock` | HTTP mocking for tests (dev) |

---

## Implementation Phases

### Phase 1: Foundation
- Initialize TypeScript project (tsconfig, package.json, eslint)
- Write custom TypeScript declarations for the untyped `smpp` package
- Implement config loader: env vars + `clients.json` file, validated with Zod
- Implement structured logger (pino) with phone number masking
- Dockerfile (multi-stage build, non-root user)

### Phase 2: Core Protocol Modules
- `credential-store.ts` -- load client configs, bcrypt password verification, system_id → config lookup
- `address-normalizer.ts` -- SMPP address (TON/NPI) → E.164
- `message-parser.ts` -- extract OTP code from full message text via regex
- `error-mapper.ts` -- OTP Blue error codes ↔ SMPP command_status mapping
- `delivery-receipt.ts` -- construct `deliver_sm` PDUs with standard receipt format
- Unit tests for all modules

### Phase 3: SMPP Server + API Client
- `otpblue-client.ts` -- HTTP client handling both 200 (success) and 400 (structured failure) responses
- `server.ts` -- SMPP server creation (plaintext on 2775, TLS on 2776)
- `session-handler.ts` -- the core orchestration:
  - Handle bind (authenticate via credential store)
  - Handle submit_sm (parse → normalize → call API → respond → DLR)
  - Handle enquire_link (respond automatically, track last activity)
  - Handle unbind (graceful close)
  - Handle errors/disconnects (cleanup session state)
- `rate-limiter.ts` -- per-client token bucket
- Integration tests: full bind → submit_sm → submit_sm_resp → deliver_sm flow using node-smpp as both server and test client

### Phase 4: Monitoring + Deployment
- Health check HTTP server on port 8080 (`/health`, `/ready`, `/metrics`)
- Prometheus metrics: connections, messages sent/failed, API latency, throttle count
- Graceful shutdown on SIGTERM (unbind all sessions → wait grace period → close)
- docker-compose.yml with port mappings, volume mounts for certs and config
- `.env.example` documenting all environment variables

### Phase 5: Testing + Hardening
- End-to-end test with a test SMPP client script
- TLS connection testing
- Concurrent multi-client connection testing
- Error scenario coverage: API timeout, invalid credentials, rate limiting, malformed PDUs
- Load testing with concurrent submit_sm PDUs

---

## Key Files to Modify/Create

| File | Purpose | Complexity |
|---|---|---|
| `src/smpp/session-handler.ts` | Core orchestration -- the heart of the connector | High |
| `src/protocol/message-parser.ts` | OTP code extraction from full message text | Medium |
| `src/protocol/error-mapper.ts` | OTP Blue ↔ SMPP error mapping (critical for failover) | Medium |
| `src/api/otpblue-client.ts` | HTTP client for OTP Blue API | Low |
| `src/smpp/types.ts` | TypeScript declarations for untyped `smpp` package | Medium |
| `src/config/schema.ts` | Zod schemas for client config validation | Low |
| `src/auth/credential-store.ts` | SMPP auth → API key resolution | Low |
| `src/protocol/address-normalizer.ts` | Phone number normalization to E.164 | Low |
| `src/protocol/delivery-receipt.ts` | Delivery receipt PDU construction | Low |

---

## Verification Plan

1. **Unit tests** (`npm test`): All protocol modules (parser, normalizer, error mapper, receipt builder, rate limiter) with dedicated test suites covering edge cases
2. **Integration test**: Use `smpp` package as both server AND client in the same test process -- simulate full flow: bind → submit_sm → receive submit_sm_resp → receive deliver_sm. Mock the OTP Blue API with nock.
3. **Manual E2E test**: Start the connector via Docker, use a simple node-smpp client script to bind and submit an OTP message to your own phone number. Verify iMessage delivery and correct SMPP responses.
4. **Failover test**: Submit a message to a non-iMessage number, verify that `submit_sm_resp` returns error immediately (not ESME_ROK), confirming aggregators can failover.
5. **Load test**: Open multiple concurrent SMPP connections and send submit_sm PDUs in parallel to verify rate limiting, session management, and throughput.
