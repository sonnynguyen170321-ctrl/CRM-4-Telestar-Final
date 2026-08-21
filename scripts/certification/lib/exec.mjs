import { spawnSync } from 'node:child_process';

/**
 * Run a command, coping with Windows batch shims.
 *
 * `spawnSync('gcloud', …)` returns ENOENT on Windows even when the Cloud SDK is installed and
 * on PATH, because `gcloud` there is `gcloud.cmd` — a batch file, which CreateProcess cannot
 * execute directly. A probe that treats ENOENT as "not installed" therefore reports a false
 * blocker on every Windows machine, which is the precise failure mode `EV-DR-RPO` already had
 * once and must not acquire again.
 *
 * `.exe` programs (docker, podman, node) are unaffected; this only retries the shim suffixes.
 */
const SHIM_SUFFIXES = ['.cmd', '.bat'];

/**
 * Since the CVE-2024-27980 mitigation, Node refuses to spawn a `.cmd` or `.bat` without a
 * shell and reports EINVAL. So the shim path has to go through the shell, which concatenates
 * rather than escapes its arguments. Every argument is therefore checked first, and anything
 * carrying shell metacharacters is refused rather than quoted-and-hoped-for.
 */
const SHELL_UNSAFE = /["'`$&|;<>^%!\n\r]/;

function quoteForWindowsShell(value) {
  if (SHELL_UNSAFE.test(value)) {
    throw new Error(
      `Refusing to pass an argument containing shell metacharacters through a Windows shim: ${value}`,
    );
  }
  return /\s/.test(value) ? `"${value}"` : value;
}

export function runCommand(command, args, { timeoutMs = 5 * 60 * 1000, env = {}, cwd } = {}) {
  const options = {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
    ...(cwd ? { cwd } : {}),
  };

  let result = spawnSync(command, args, options);
  if (process.platform !== 'win32') return result;

  // ENOENT: the bare name does not resolve. EINVAL: it resolved to a batch shim.
  for (const suffix of SHIM_SUFFIXES) {
    if (result.error?.code !== 'ENOENT' && result.error?.code !== 'EINVAL') break;
    const line = [command + suffix, ...args.map(quoteForWindowsShell)].join(' ');
    result = spawnSync(line, { ...options, shell: true });
  }

  return result;
}

/** True only when the command could not be found at all — never merely because it failed. */
export function isMissingCommand(result) {
  return result.error?.code === 'ENOENT';
}
