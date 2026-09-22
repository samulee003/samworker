import fs from 'node:fs';
import path from 'node:path';
import type { AdapterResult, ToolAdapter } from '../../types.js';

function sanitizePath(workspaceRoot: string, userPath: string): string {
  const root = path.resolve(workspaceRoot);
  let resolved = path.resolve(root, userPath);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // keep resolved when path does not exist yet
  }
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path traversal denied');
  }
  return resolved;
}

export const fsAdapter: ToolAdapter = {
  name: 'fs',
  tools: ['fs.listDir', 'fs.readFile', 'fs.writeFile', 'fs.searchContent'],
  getSchema: () => null,
  async execute(tool, args, ctx): Promise<AdapterResult> {
    const full = sanitizePath(ctx.workspaceRoot, String(args.path ?? ''));
    if (tool === 'fs.readFile') {
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: ${args.path}`);
        err.code = 'ENOENT';
        throw err;
      }
      const st = fs.statSync(full);
      if (st.size > 10 * 1024 * 1024) throw new Error('File too large');
      const content = fs.readFileSync(full, args.encoding === 'base64' ? 'base64' : 'utf8');
      return { data: { content, path: args.path } };
    }
    if (tool === 'fs.writeFile') {
      if (typeof args.reason !== 'string' || args.reason.length < 1) {
        const e: any = new Error('reason required');
        e.name = 'SchemaError';
        throw e;
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, String(args.content ?? ''), 'utf8');
      return { data: { ok: true, path: args.path } };
    }
    if (tool === 'fs.listDir') {
      const root = path.resolve(ctx.workspaceRoot);
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = path.relative(root, path.join(dir, ent.name)).replaceAll('\\', '/');
          out.push(rel);
          if (ent.isDirectory() && args.recursive) walk(path.join(dir, ent.name));
        }
      };
      walk(full);
      return { data: { entries: out } };
    }
    if (tool === 'fs.searchContent') {
      const text = fs.readFileSync(full, 'utf8');
      const re = new RegExp(String(args.pattern ?? ''));
      const results = text
        .split('\n')
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter((r) => re.test(r.text))
        .slice(0, 20);
      return { data: { results } };
    }
    throw new Error(`Unknown tool ${tool}`);
  },
};
