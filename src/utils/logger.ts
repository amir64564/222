const SECRET_KEYS = ["privatekey", "apikey", "apisecret", "bearertoken", "bottoken", "seed"];

function redact(input: unknown): unknown {
  if (typeof input === "string") {
    // Redact anything that looks like a private key / long hex / base58 secret accidentally logged
    return input;
  }
  if (input && typeof input === "object") {
    const clone: Record<string, unknown> = Array.isArray(input) ? ([] as unknown as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (SECRET_KEYS.some((s) => lower.includes(s))) {
        clone[k] = "[REDACTED]";
      } else {
        clone[k] = redact(v);
      }
    }
    return clone;
  }
  return input;
}

function ts(): string {
  return new Date().toISOString();
}

export const logger = {
  info: (msg: string, meta?: unknown) => {
    console.log(`[${ts()}] [INFO] ${msg}`, meta !== undefined ? redact(meta) : "");
  },
  warn: (msg: string, meta?: unknown) => {
    console.warn(`[${ts()}] [WARN] ${msg}`, meta !== undefined ? redact(meta) : "");
  },
  error: (msg: string, meta?: unknown) => {
    console.error(`[${ts()}] [ERROR] ${msg}`, meta !== undefined ? redact(meta) : "");
  },
};
