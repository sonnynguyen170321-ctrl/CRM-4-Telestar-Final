import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CANDIDATE_IMAGE_REPO,
  containerRuntime,
  gateDockerBuild,
  gateImageInspection,
} from '../scripts/certification/lib/imageGates.mjs';

/**
 * Gates 19 and 20 were recorded as BLOCKED_EXTERNAL by a hardcoded constant, with the reason
 * "no container runtime on the certification workstation". The reason was true of the machine
 * but the code never checked it, so three certification runs failed on a literal — and
 * installing a container runtime would not have changed a single verdict.
 *
 * These tests pin both halves: the gates must attempt real work when a runtime answers, and
 * must never report a pass when one does not.
 */

const SHA = 'd'.repeat(40);
const IMAGE_ID = 'sha256:' + 'a'.repeat(64);

function blockedGate(gateId: string, description: string, reason: string) {
  return { gateId, description, status: 'BLOCKED_EXTERNAL', exitCode: 127, metrics: { reason } };
}

function writeLog() {
  return '/tmp/fake.log';
}

describe('containerRuntime', () => {
  it('asks the daemon rather than trusting PATH', () => {
    // An installed-but-not-running Docker Desktop resolves on PATH and fails every command.
    const shell = vi.fn().mockReturnValue({ status: 1, stdout: '', stderr: 'daemon not running' });
    expect(containerRuntime(shell)).toBeNull();
    expect(shell).toHaveBeenCalledWith('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeoutMs: 60_000,
    });
  });

  it('reports the runtime when the daemon answers', () => {
    const shell = vi.fn().mockReturnValue({ status: 0, stdout: '27.1.1\n', stderr: '' });
    expect(containerRuntime(shell)).toEqual({ command: 'docker', version: '27.1.1' });
  });

  it('falls back to podman when docker does not answer', () => {
    const shell = vi.fn((command: string) =>
      command === 'podman'
        ? { status: 0, stdout: '5.2.0\n', stderr: '' }
        : { status: 1, stdout: '', stderr: '' },
    );
    expect(containerRuntime(shell)).toEqual({ command: 'podman', version: '5.2.0' });
  });
});

describe('gate 19 — docker build', () => {
  it('is BLOCKED_EXTERNAL, never PASS, when no runtime answers', () => {
    const scriptGate = vi.fn();
    const gate = gateDockerBuild({
      runtime: null,
      candidateSha: SHA,
      runLabel: 'run1',
      scriptGate,
      blockedGate,
    });
    expect(gate.status).toBe('BLOCKED_EXTERNAL');
    expect(gate.status).not.toBe('PASS');
    // The crucial part: it must not silently pretend to have tried.
    expect(scriptGate).not.toHaveBeenCalled();
    expect(gate.metrics.reason).toContain('no container runtime answers');
  });

  it('actually builds when a runtime answers', () => {
    const scriptGate = vi.fn().mockReturnValue({ status: 'PASS', exitCode: 0 });
    gateDockerBuild({
      runtime: { command: 'docker', version: '27.1.1' },
      candidateSha: SHA,
      runLabel: 'run1',
      scriptGate,
      blockedGate,
    });

    expect(scriptGate).toHaveBeenCalledOnce();
    const [, , command, args] = scriptGate.mock.calls[0];
    expect(command).toBe('docker');
    expect(args).toContain('build');
    expect(args).toContain(`APP_COMMIT=${SHA}`);
    expect(args).toContain(`${CANDIDATE_IMAGE_REPO}:${SHA}`);
  });

  it('tags the build by candidate SHA and never by a floating tag', () => {
    const scriptGate = vi.fn().mockReturnValue({ status: 'PASS', exitCode: 0 });
    gateDockerBuild({
      runtime: { command: 'docker', version: '27.1.1' },
      candidateSha: SHA,
      runLabel: 'run1',
      scriptGate,
      blockedGate,
    });
    const args: string[] = scriptGate.mock.calls[0][3];
    const tags = args.filter((_, i) => args[i - 1] === '-t');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toBe(`${CANDIDATE_IMAGE_REPO}:${SHA}`);
    expect(tags[0]).not.toMatch(/:(latest|main|master|edge)$/);
  });
});

describe('gate 20 — image inspection', () => {
  const runtime = { command: 'docker', version: '27.1.1' };

  function inspecting(stdout: string, status = 0) {
    return gateImageInspection({
      runtime,
      candidateSha: SHA,
      buildStatus: 'PASS',
      runLabel: 'run1',
      shell: vi.fn().mockReturnValue({ status, stdout, stderr: '' }),
      writeLog,
      blockedGate,
    });
  }

  it('is BLOCKED_EXTERNAL when no runtime answers', () => {
    const gate = gateImageInspection({
      runtime: null,
      candidateSha: SHA,
      buildStatus: 'PASS',
      runLabel: 'run1',
      shell: vi.fn(),
      writeLog,
      blockedGate,
    });
    expect(gate.status).toBe('BLOCKED_EXTERNAL');
  });

  it('is BLOCKED_EXTERNAL — not FAIL, not PASS — when gate 19 produced no image', () => {
    const gate = gateImageInspection({
      runtime,
      candidateSha: SHA,
      buildStatus: 'BLOCKED_EXTERNAL',
      runLabel: 'run1',
      shell: vi.fn(),
      writeLog,
      blockedGate,
    });
    expect(gate.status).toBe('BLOCKED_EXTERNAL');
    expect(gate.metrics.reason).toContain('nothing to inspect');
  });

  it('passes when the image carries the candidate identity by digest', () => {
    const gate = inspecting(`${IMAGE_ID}\t${SHA}\t${CANDIDATE_IMAGE_REPO}:${SHA}`);
    expect(gate.status).toBe('PASS');
    expect(gate.exitCode).toBe(0);
    expect(gate.metrics.findings).toEqual([]);
    expect(gate.metrics.imageId).toBe(IMAGE_ID);
  });

  it('fails when the image revision label is not the candidate', () => {
    // The exact failure REL-001 exists to prevent: an image that is not the frozen commit.
    const other = 'e'.repeat(40);
    const gate = inspecting(`${IMAGE_ID}\t${other}\t${CANDIDATE_IMAGE_REPO}:${SHA}`);
    expect(gate.status).toBe('FAIL');
    expect(gate.metrics.findings.join(' ')).toContain('not the candidate');
  });

  it('fails when the image carries no revision label at all', () => {
    const gate = inspecting(`${IMAGE_ID}\t\t${CANDIDATE_IMAGE_REPO}:${SHA}`);
    expect(gate.status).toBe('FAIL');
    expect(gate.metrics.findings.join(' ')).toContain('(none)');
  });

  it('fails when the image is referenced by a floating tag', () => {
    const gate = inspecting(
      `${IMAGE_ID}\t${SHA}\t${CANDIDATE_IMAGE_REPO}:${SHA},${CANDIDATE_IMAGE_REPO}:latest`,
    );
    expect(gate.status).toBe('FAIL');
    expect(gate.metrics.findings.join(' ')).toContain('floating tag');
  });

  it('fails when the image id is not a sha256 digest', () => {
    const gate = inspecting(`not-a-digest\t${SHA}\t${CANDIDATE_IMAGE_REPO}:${SHA}`);
    expect(gate.status).toBe('FAIL');
    expect(gate.metrics.findings.join(' ')).toContain('not a sha256 digest');
  });

  it('fails, rather than passing silently, when inspect itself errors', () => {
    const gate = inspecting('', 1);
    expect(gate.status).toBe('FAIL');
    expect(gate.metrics.findings.join(' ')).toContain('image inspect failed');
  });
});

describe('the ladder no longer hardcodes the image gates as blocked', () => {
  const runner = readFileSync(
    join(process.cwd(), 'scripts', 'certification', 'run-full-certification.mjs'),
    'utf8',
  );

  it('probes for a runtime instead of assuming there is none', () => {
    expect(runner).toContain('containerRuntime(shell)');
  });

  it('no longer carries the hardcoded blocked reason', () => {
    expect(runner).not.toContain('no container runtime on the certification workstation');
    expect(runner).not.toContain('no image exists to inspect; see TEL-P1-018');
  });

  it('still records both gates on every run', () => {
    expect(runner).toContain('gateDockerBuild(');
    expect(runner).toContain('gateImageInspection(');
  });
});
