import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

// Path to the .env the running process should persist edits into. In compose the
// host .env is bind-mounted to /app/.env (see IDENSTR_ENV_FILE); in dev it is the
// project-root .env.
export function getEnvFilePath() {
  return process.env.IDENSTR_ENV_FILE ?? join(root, '.env');
}

// Persist a single KEY=value into the .env file, preserving every other line
// (comments, ordering, and secrets like IDENSTR_NSEC) verbatim. Appends the key
// if it is not already present. Writes in place: the file is a bind mount, so it
// cannot be replaced via temp-file rename.
export async function updateEnvVar(key, value, path = getEnvFilePath()) {
  let original = '';
  try {
    original = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const line = `${key}=${value}`;
  const matcher = new RegExp(`^\\s*${escapeRegExp(key)}=`);
  const lines = original.length ? original.split('\n') : [];
  let replaced = false;
  const next = lines.map((existing) => {
    if (!replaced && matcher.test(existing)) {
      replaced = true;
      return line;
    }
    return existing;
  });
  if (!replaced) {
    if (next.length && next[next.length - 1] === '') next.splice(next.length - 1, 0, line);
    else next.push(line);
  }
  let output = next.join('\n');
  if (original.endsWith('\n') && !output.endsWith('\n')) output += '\n';
  await writeFile(path, output);
  process.env[key] = value;
  return { path, key, value, replaced };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
