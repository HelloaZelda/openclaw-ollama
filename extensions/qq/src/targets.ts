export function normalizeQqTarget(raw?: string | null): string | null {
  const value = raw?.trim() ?? "";
  if (!value) {
    return null;
  }

  const normalized = value.replace(/^qq:/i, "").trim();
  if (!normalized) {
    return null;
  }

  // Supported forms:
  // - channel:<channelId>
  // - dm:<dmGuildId>
  // - <channelId> (treated as channel id)
  const match = /^(channel|dm):(.+)$/i.exec(normalized);
  if (match) {
    const mode = match[1]?.toLowerCase() === "dm" ? "dm" : "channel";
    const id = match[2]?.trim() ?? "";
    if (!id) {
      return null;
    }
    return `${mode}:${id}`;
  }
  return `channel:${normalized}`;
}

export function parseQqNormalizedTarget(
  normalized: string,
): { mode: "channel" | "dm"; id: string } | null {
  const trimmed = normalized.trim();
  if (!trimmed) {
    return null;
  }
  const match = /^(channel|dm):(.+)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const mode = match[1] === "dm" ? "dm" : "channel";
  const id = match[2].trim();
  if (!id) {
    return null;
  }
  return { mode, id };
}
