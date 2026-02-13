---
summary: "Connect OpenClaw to QQ Channels (QQ Guild) via the official bot platform"
read_when:
  - You want to chat with OpenClaw from QQ Channels
title: "QQ Channels"
---

# QQ Channels

Status: plugin channel (inbound via Webhook; signed with Ed25519).

## Install

Install the plugin:

```bash
openclaw plugins install @openclaw/qq
```

Or from this repo:

```bash
openclaw plugins install ./extensions/qq
```

## QQ Bot Setup

1. Create a QQ Channels bot app in the official bot platform.
2. Copy the **AppID** and **Client Secret**.
3. Configure **Event subscription** (Webhook) and set the callback URL to your Gateway's public HTTPS endpoint.

Notes:

- Webhook callbacks must be reachable over **HTTPS**.
- OpenClaw verifies webhook requests using `X-Signature-Ed25519` + `X-Signature-Timestamp`.

## Configure OpenClaw

Example:

```yaml
channels:
  qq:
    enabled: true
    appId: "YOUR_APP_ID"
    clientSecret: "YOUR_CLIENT_SECRET"
    # Or: clientSecretFile: "/path/to/qq.secret"
    webhookPath: "/qq"
    dmPolicy: pairing
    allowFrom:
      - "123456789"
    groupPolicy: allowlist
    groupAllowFrom:
      - "1234567890123456789" # channel_id
```

If you run the Gateway behind a reverse proxy, route the plugin webhook path to the Gateway.

## Pairing / Allowlist

- Default DM policy is `pairing`.
- To approve a pairing request:

```bash
openclaw pairing approve qq <CODE>
```

## Sending Messages

Targets:

- `qq channel:<channel_id>`
- `qq dm:<dm_guild_id>`

Example:

```bash
openclaw message send qq "channel:1234567890123456789" "hello from OpenClaw"
```
