/**
 * Doctor core decision logic — pure functions for testing and runtime.
 *
 * Extracted so Vitest can test the EXACT decision logic Doctor uses
 * without mocking process.exit or whole CLI runs.
 */

// ---------------------------------------------------------------------------
// Canonical runtime versions
// ---------------------------------------------------------------------------
export const CANONICAL_NODE = '24.18.0';
export const CANONICAL_NPM = '11.16.0';

// ---------------------------------------------------------------------------
// Credential sanitization
// ---------------------------------------------------------------------------

/**
 * Strip credentials, passwords, and sensitive URL tokens from text.
 */
export function sanitizeDiagnosticText(text) {
  if (!text) return '';
  return text
    // Postgres URLs (handles postgresql:// and postgres:// with pass/user)
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '<redacted-pg-url>')
    // Redis URLs
    .replace(/rediss?:\/\/[^\s'"]+/gi, '<redacted-redis-url>')
    // Generic credential-shaped URLs (scheme://user:pass@host)
    .replace(/[a-z]+:\/\/[^:]+:[^@]+@[^\s'"]+/gi, '<redacted-url>')
    // Hex keys (64-char) that look like ENCRYPTION_KEY values
    .replace(/[0-9a-f]{64}/gi, '<redacted-hex-key>')
    // Known env var assignment patterns
    .replace(/(?:API_KEY|SECRET|PASSWORD|TOKEN|ENCRYPTION_KEY)=\S+/gi, '<redacted>');
}

// ---------------------------------------------------------------------------
// Version validation
// ---------------------------------------------------------------------------

export function evaluateVersionState({ nvmrc, nodeVersionFile, actualNode, actualNpm }) {
  const errors = [];
  const warnings = [];

  // File consistency
  if (nvmrc && nodeVersionFile) {
    if (nvmrc.trim() !== nodeVersionFile.trim()) {
      errors.push(`.nvmrc (${nvmrc.trim()}) and .node-version (${nodeVersionFile.trim()}) diverge`);
    }
  } else if (!nvmrc && !nodeVersionFile) {
    errors.push('Neither .nvmrc nor .node-version file found');
  }

  // Node exact match
  if (actualNode !== CANONICAL_NODE) {
    errors.push(`Node version is ${actualNode} (expected ${CANONICAL_NODE})`);
  }

  // npm exact match
  if (actualNpm !== CANONICAL_NPM) {
    errors.push(`npm version is ${actualNpm} (expected ${CANONICAL_NPM})`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Git & Remote validation
// ---------------------------------------------------------------------------

export function evaluateGitState({ branch, isClean, localSha, remoteSha, remoteAvailable, requireMain }) {
  const isOnMain = branch === 'main';
  let status = 'PASS';
  let message = '';
  let isFailure = false;

  if (requireMain && !isOnMain) {
    return {
      ok: false,
      status: 'FAIL',
      message: 'not on main — use git switch main',
      workingTreeClean: isClean,
    };
  }

  if (!isClean && requireMain) {
    isFailure = true;
  }

  if (!remoteAvailable) {
    if (requireMain) {
      status = 'FAIL';
      message = 'remote unavailable (network required for --require-main)';
      isFailure = true;
    } else {
      status = 'WARN';
      message = 'remote: unavailable (network)';
    }
  } else if (isOnMain) {
    if (localSha === remoteSha) {
      status = 'PASS';
      message = 'synchronized';
    } else {
      status = 'FAIL';
      message = 'not synchronized with remote main';
      isFailure = true;
    }
  } else {
    const shortRemote = (remoteSha || '').slice(0, 7);
    status = 'INFO';
    message = `${shortRemote} (diverged — expected on feature branch)`;
  }

  return {
    ok: !isFailure,
    status,
    message,
    workingTreeClean: isClean,
  };
}

// ---------------------------------------------------------------------------
// Topology classification
// ---------------------------------------------------------------------------

export function classifyTopology(appClassification, directClassification, redisClassification) {
  const items = [
    appClassification,
    directClassification,
    redisClassification,
  ].filter(Boolean);

  if (items.length === 0) return 'unknown';

  const allLocal = items.every((c) => c === 'local');
  const allRemote = items.every((c) => c === 'remote');

  if (allLocal) return 'all-local';
  if (allRemote) return 'all-remote';
  return 'hybrid';
}

// ---------------------------------------------------------------------------
// Strict Email Safety Validation
// ---------------------------------------------------------------------------

export function evaluateStrictEmailSafety(env) {
  const dryRunValue = (env.EMAIL_SEND_DRY_RUN ?? '').trim().toLowerCase();
  const autosendValue = (env.SEQUENCE_AUTOSEND_ENABLED ?? '').trim().toLowerCase();

  const dryRunStrict = dryRunValue === 'true';
  const autosendStrict = autosendValue === 'false';

  const actionItems = [];
  if (!dryRunStrict) {
    actionItems.push(
      'EMAIL_SEND_DRY_RUN is not "true". Set it to "true" in .env to prevent live email sending in development.'
    );
  }
  if (!autosendStrict) {
    actionItems.push(
      'SEQUENCE_AUTOSEND_ENABLED is not "false". Set it to "false" in .env to prevent automated sequence email sending in development.'
    );
  }

  return {
    ok: dryRunStrict && autosendStrict,
    dryRunStrict,
    autosendStrict,
    actionItems,
  };
}
