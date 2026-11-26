import fs from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(logDir: string): Logger {
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }
  const logFile = path.join(logDir, 'bridge.log');

  function write(level: string, msg: string, meta?: Record<string, unknown>) {
    const ts = new Date().toISOString();
    const safeMeta = meta ? ' ' + JSON.stringify(redact(meta)) : '';
    const line = `${ts} [${level}] ${msg}${safeMeta}\n`;
    try {
      // simple rotation: if file > 5MB, rename
      try {
        const st = fs.statSync(logFile);
        if (st.size > 5 * 1024 * 1024) {
          fs.renameSync(logFile, logFile + '.' + Date.now());
        }
      } catch { /* ignore */ }
      fs.appendFileSync(logFile, line);
    } catch { /* ignore */ }
    // also console
    // eslint-disable-next-line no-console
    console.log(line.trim());
  }

  function redact(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/token|secret|code|password|key/i.test(k)) out[k] = '***';
      else out[k] = v;
    }
    return out;
  }

  return {
    info: (m, meta) => write('INFO', m, meta),
    warn: (m, meta) => write('WARN', m, meta),
    error: (m, meta) => write('ERROR', m, meta),
    debug: (m, meta) => write('DEBUG', m, meta),
  };
}