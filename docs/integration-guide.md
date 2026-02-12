# SMPP Integration Guide for SMS Aggregators

## Overview

OTP Blue provides OTP code delivery via iMessage. This SMPP interface allows you to route OTP traffic to OTP Blue using the standard SMPP protocol — the same way you connect to any SMS carrier or channel.

Key benefits:
- **Instant delivery status** — You know if the message was delivered immediately (faster than SMS)
- **Instant failover** — If the recipient doesn't have iMessage, you get an error response immediately so you can failover to SMS without delay
- **Standard SMPP** — No special integration work; use your existing SMPP client infrastructure

## Connection Details

| Parameter | Value |
|---|---|
| **Protocol** | SMPP v3.4 |
| **Plaintext port** | 2775 |
| **TLS port** | 2776 (recommended) |
| **Bind mode** | Transceiver (TRX) recommended |
| **Host** | Provided during onboarding |
| **system_id** | Provided during onboarding |
| **password** | Provided during onboarding |

## SMPP Session Lifecycle

```
1. TCP Connect to host:port
2. bind_transceiver (system_id, password)
   ← bind_transceiver_resp (ESME_ROK on success)
3. Exchange messages:
   → submit_sm (OTP message)
   ← submit_sm_resp (delivery status)
   ← deliver_sm (delivery receipt, if requested)
   ↔ enquire_link / enquire_link_resp (keepalive)
4. unbind / unbind_resp
5. TCP Close
```

### Keepalive

Send `enquire_link` at least every 60 seconds. Sessions that are idle for more than 90 seconds will be disconnected.

## Sending OTP Messages

### submit_sm Fields

| Field | Value | Description |
|---|---|---|
| `source_addr_ton` | `0x05` | Alphanumeric (for brand name) |
| `source_addr` | Your brand name | e.g., `"MyBank"` — appears as bold subject line in iMessage (max 11 chars) |
| `dest_addr_ton` | `0x01` | International |
| `dest_addr_npi` | `0x01` | ISDN / E.164 |
| `destination_addr` | Recipient phone | E.164 format with country code, e.g., `"14155551234"` |
| `data_coding` | `0x00` | Default (ASCII/GSM 7-bit) |
| `short_message` | Full OTP message | e.g., `"Your verification code is 482910"` |
| `registered_delivery` | `0x01` | Request delivery receipt (recommended) |

### Example submit_sm

```
source_addr_ton:    0x05 (Alphanumeric)
source_addr:        "MyBank"
dest_addr_ton:      0x01 (International)
dest_addr_npi:      0x01 (ISDN)
destination_addr:   "14155551234"
data_coding:        0x00
registered_delivery: 0x01
short_message:      "Your verification code is 482910. Do not share this code."
```

### Sender Name (Alpha Name)

The `source_addr` field with `source_addr_ton=0x05` (Alphanumeric) carries your enterprise brand name. This is displayed as the **bold subject line** in the iMessage OTP notification, giving the recipient clear brand context.

- Use TON `0x05` (Alphanumeric) and set `source_addr` to your brand name
- Maximum 11 characters (standard SMPP alphanumeric limit)
- Examples: `"MyBank"`, `"Acme"`, `"1xBet"`

If you send with a numeric `source_addr` (TON `0x01` or `0x03`), the sender name will fall back to the default configured during your onboarding.

### OTP Code Extraction

The connector automatically extracts the OTP code from your message text. You can send messages in any standard format:

```
"Your verification code is 482910"           → extracts "482910"
"OTP: 123456"                                 → extracts "123456"
"Use code 482910 to verify your account"      → extracts "482910"
"482910"                                      → extracts "482910"
"Your PIN is 9821"                            → extracts "9821"
"code: 482-910"                               → extracts "482910"
```

The OTP code must be 4-10 digits. The connector extracts it and delivers it using OTP Blue's iMessage template, with your brand name displayed as the bold subject line.

### Language

The iMessage template language is configured per account during onboarding. If your traffic serves multiple countries, the connector can automatically select the template language based on the destination phone number's country code.

Supported languages: English, French, German, Spanish, Italian, Portuguese, Dutch, Polish, Swedish, Norwegian, Danish, Finnish, Romanian, Bulgarian, Ukrainian, Russian, Turkish, Japanese, Korean, Chinese, Indonesian, Malay, Vietnamese, Icelandic.

## Response Handling

### submit_sm_resp

The response arrives immediately (no queuing — the delivery status is known synchronously).

| command_status | Hex | Meaning | Your action |
|---|---|---|---|
| `ESME_ROK` | `0x00` | Delivered via iMessage | Success — OTP was delivered |
| `ESME_RSUBMITFAIL` | `0x45` | No iMessage (recipient not on iMessage) | **Failover to SMS route** |
| `ESME_RTHROTTLED` | `0x58` | Rate limit exceeded or no capacity | Retry after backoff or failover |
| `ESME_RINVDSTADR` | `0x0B` | Invalid/unsupported phone number | Drop — number is invalid |
| `ESME_RSYSERR` | `0x08` | Temporary system error | Retry or failover |
| `ESME_RINVMSGLEN` | `0x01` | Could not extract OTP code from message | Check your message format |
| `ESME_RINVBNDSTS` | `0x04` | Not bound / wrong bind mode | Bind first, then submit |
| `ESME_RINVPASWD` | `0x0E` | Authentication failed | Check system_id and password |

### Delivery Receipts (deliver_sm)

If you set `registered_delivery=0x01` in your `submit_sm`, you will also receive a delivery receipt as a `deliver_sm` PDU:

```
esm_class:            0x04 (MC_DELIVERY_RECEIPT)
receipted_message_id: "abc-123" (matches message_id from submit_sm_resp)
message_state:        2 (DELIVERED) or 5 (UNDELIVERABLE)
short_message:        "id:abc-123 sub:001 dlvrd:001 submit date:2602121430 done date:2602121430 stat:DELIVRD err:000 text:"
```

**Important**: You must respond to `deliver_sm` with a `deliver_sm_resp` promptly.

Since the OTP Blue API is synchronous, the delivery receipt arrives immediately after the `submit_sm_resp` — you don't need to wait.

## Failover Configuration

### Recommended Routing Setup

Configure OTP Blue as a **primary route for OTP traffic** with automatic failover to your standard SMS routes:

```
OTP Message
    │
    ▼
Route 1: OTP Blue (SMPP)
    │
    ├── ESME_ROK → Delivered via iMessage ✓
    │
    └── ESME_RSUBMITFAIL (no iMessage)
        │
        ▼
    Route 2: SMS Carrier A
        │
        ├── ESME_ROK → Delivered via SMS ✓
        └── Error → Route 3: SMS Carrier B
```

### Failover Trigger

Use `submit_sm_resp` error status for failover decisions:

- **Failover immediately**: `ESME_RSUBMITFAIL` (0x45) — recipient doesn't have iMessage
- **Retry then failover**: `ESME_RTHROTTLED` (0x58), `ESME_RSYSERR` (0x08)
- **Do not failover**: `ESME_RINVDSTADR` (0x0B) — the phone number itself is invalid

The error response is instant (typically <500ms), so the end-user won't notice any delay from the failover attempt.

## Rate Limits

Your account has a configured maximum transactions per second (TPS). If you exceed this rate, you will receive `ESME_RTHROTTLED` (0x58). Implement standard SMPP backoff when you receive this error.

You can use SMPP windowing (multiple unacknowledged submit_sm PDUs in flight) for throughput, but total rate should stay within your TPS limit.

## Supported Destinations

iMessage OTP delivery is available in 60+ countries. Contact OTP Blue for the current list of supported destinations and to request additional countries.

Messages to unsupported regions will receive error `ESME_RINVDSTADR`.

## Testing

### 1. Test the SMPP connection

Connect with your SMPP client and verify a successful bind:
```
→ bind_transceiver (system_id, password)
← bind_transceiver_resp (command_status: 0x00 = success)
```

### 2. Send a test OTP to your own number

```
→ submit_sm (destination: your phone number, message: "Your code is 123456")
← submit_sm_resp (command_status: 0x00, message_id: "...")
← deliver_sm (stat:DELIVRD)
```

Check your iPhone for the iMessage notification.

### 3. Test failover (non-iMessage number)

Send to a phone number that doesn't have iMessage (e.g., an Android number):
```
→ submit_sm (destination: android number, message: "Your code is 123456")
← submit_sm_resp (command_status: 0x45 = ESME_RSUBMITFAIL)
```

Verify that your routing engine failovers to an SMS route.

### 4. Test keepalive

Verify your `enquire_link` interval is working:
```
→ enquire_link
← enquire_link_resp (command_status: 0x00)
```

## Troubleshooting

| Issue | Cause | Solution |
|---|---|---|
| Bind rejected (0x0E) | Wrong system_id or password | Verify credentials with OTP Blue |
| Bind rejected (0x0D) | IP not whitelisted | Request your IP to be added |
| submit_sm returns 0x04 | Not bound | Send bind_transceiver first |
| submit_sm returns 0x01 | OTP code not found in message | Ensure message contains a 4-10 digit code |
| submit_sm returns 0x45 | Recipient has no iMessage | Expected — failover to SMS |
| submit_sm returns 0x58 | Rate limit exceeded | Reduce sending rate or request higher TPS |
| Session disconnected | Inactivity timeout (90s) | Send enquire_link every 30-60 seconds |
| No delivery receipt | `registered_delivery` not set | Set `registered_delivery=0x01` in submit_sm |

## Contact

For onboarding, API keys, and technical support, contact the OTP Blue team.
