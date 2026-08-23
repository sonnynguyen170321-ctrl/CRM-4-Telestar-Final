import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const CERT_DIR = path.join(REPO_ROOT, 'docs', 'production-certification');
export const EVIDENCE_DIR = path.join(CERT_DIR, 'evidence');
export const RAW_DIR = path.join(EVIDENCE_DIR, 'raw');
export const RUNS_DIR = path.join(CERT_DIR, 'runs');
export const RUN_MANIFEST_DIR = path.join(RUNS_DIR, 'manifests');

export const CONFIG_PATH = path.join(CERT_DIR, 'certification.config.json');
export const REQUIREMENTS_PATH = path.join(CERT_DIR, 'requirements.json');
export const PROGRESS_PATH = path.join(CERT_DIR, 'progress.json');
/**
 * Release identity lives in its own file, deliberately NOT in `shaDeclaringFiles`.
 *
 * Check A requires every 40-character SHA inside a declaring file to be the candidate, which is
 * right: a status document naming a superseded SHA is how a stale candidate survives. But this
 * record exists to state which identities DISAGREE with the candidate — a deployment still on an
 * older commit is the finding, not a stale reference — so the two rules are incompatible by
 * construction. Separating the file keeps check A strict instead of carving an exemption into it.
 */
export const RELEASE_IDENTITY_PATH = path.join(CERT_DIR, 'release-identity.json');
export const CERTIFICATE_PATH = path.join(CERT_DIR, 'FINAL_CERTIFICATE.md');
export const DEFECTS_PATH = path.join(CERT_DIR, 'DEFECTS.md');

/** SHA-256 of the empty byte sequence. An artifact with content can never hash to this. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export function repoRelative(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
}
