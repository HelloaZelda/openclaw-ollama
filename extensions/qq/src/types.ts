export type QqWebhookPayload = {
  op?: number;
  s?: number;
  t?: string;
  d?: unknown;
  id?: string;
};

export type QqWebhookValidationRequest = {
  op: 13;
  d?: {
    plain_token?: string;
    event_ts?: string;
  };
};

export type QqAuthor = {
  id?: string;
  username?: string;
  bot?: boolean;
};

export type QqAttachment = {
  url?: string;
  content_type?: string;
  filename?: string;
  size?: number;
};

export type QqMessage = {
  id?: string;
  channel_id?: string;
  guild_id?: string;
  content?: string;
  timestamp?: string;
  author?: QqAuthor;
  mentions?: QqAuthor[];
  attachments?: QqAttachment[];
};
