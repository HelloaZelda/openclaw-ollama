---
summary: "Feishu/Lark bot channel (plugin)"
read_when:
  - You want to connect OpenClaw to Feishu or Lark
  - You are configuring the Feishu channel plugin
title: "Feishu"
---

# Feishu

OpenClaw supports Feishu (Lark) via a plugin channel.

## Install

Install the Feishu plugin into your OpenClaw Gateway environment.

If you are using the repo docker-compose setup, you typically bake plugins into the image (see `Dockerfile` and `docker-compose.yml`).

## Configure

Feishu commonly uses an App ID and App Secret.

If your deployment uses environment variables, ensure these are set (examples):

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

Then follow the plugin's onboarding/config prompts to finish setup.

## Notes

- Keep secrets out of git and avoid pasting them into issues or PRs.
- If you have multiple channels enabled, routing and allowlists still apply.

