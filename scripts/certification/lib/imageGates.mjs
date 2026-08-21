/**
 * The two image gates, 19 and 20.
 *
 * These were previously recorded as `BLOCKED_EXTERNAL` unconditionally, with the reason
 * "no container runtime on the certification workstation". That reason was true of the
 * machine, but the code did not check it: the gates never attempted anything, so installing
 * a container runtime would not have changed a single run's verdict. Three certification
 * runs failed on a hardcoded constant.
 *
 * They now run wherever a runtime answers, and record `BLOCKED_EXTERNAL` only where one
 * genuinely does not. `BLOCKED_EXTERNAL` is never a pass either way.
 *
 * The runner injects `shell`, `writeLog`, `scriptGate` and `blockedGate` so this module can
 * be exercised without executing the ladder.
 */

export const CANDIDATE_IMAGE_REPO = 'telestar-crm-candidate';

const FLOATING_TAG = /:(latest|main|master|edge)$/;

/**
 * Is there a container runtime that actually answers?
 *
 * `command -v docker` is not enough: a Docker Desktop that is installed but not running
 * resolves on PATH and then fails every command. Ask the daemon.
 */
export function containerRuntime(shell) {
  for (const command of ['docker', 'podman']) {
    const probe = shell(command, ['version', '--format', '{{.Server.Version}}'], {
      timeoutMs: 60_000,
    });
    if (probe.status === 0) {
      return { command, version: (probe.stdout || '').trim() };
    }
  }
  return null;
}

/** Gate 19 — build the image from the candidate tree, tagged by SHA and never by `latest`. */
export function gateDockerBuild({ runtime, candidateSha, runLabel, scriptGate, blockedGate, now = () => new Date() }) {
  if (!runtime) {
    return blockedGate(
      '19-docker-build',
      'Docker image build from candidate SHA',
      'no container runtime answers on this machine (docker/podman); install one and re-run',
    );
  }

  const builtAt = now().toISOString();
  return {
    ...scriptGate(
      '19-docker-build',
      'Docker image build from candidate SHA',
      runtime.command,
      [
        'build',
        '--build-arg',
        `APP_COMMIT=${candidateSha}`,
        '--build-arg',
        `APP_VERSION=${candidateSha}`,
        '--build-arg',
        `APP_BUILT_AT=${builtAt}`,
        // Tagged by the candidate SHA. Never `latest`: a floating tag is not an identity.
        '-t',
        `${CANDIDATE_IMAGE_REPO}:${candidateSha}`,
        '-f',
        'Dockerfile',
        '.',
      ],
      { runLabel, timeoutMs: 60 * 60 * 1000 },
    ),
    gateId: '19-docker-build',
  };
}

/**
 * Gate 20 — the built image must carry the candidate's identity, by digest.
 *
 * Three things have to hold, and all three are read back off the image rather than assumed:
 * the image id is a real sha256; the revision label equals the candidate SHA; and the image
 * is not referenced by a floating tag.
 */
export function gateImageInspection({
  runtime,
  candidateSha,
  buildStatus,
  runLabel,
  shell,
  writeLog,
  blockedGate,
  now = () => new Date(),
}) {
  if (!runtime) {
    return blockedGate(
      '20-image-inspection',
      'Image digest captured by digest, never by floating tag',
      'no container runtime answers on this machine, so no image exists to inspect',
    );
  }
  if (buildStatus !== 'PASS') {
    return blockedGate(
      '20-image-inspection',
      'Image digest captured by digest, never by floating tag',
      'gate 19 did not produce an image, so there is nothing to inspect',
    );
  }

  const startedAt = now();
  const reference = `${CANDIDATE_IMAGE_REPO}:${candidateSha}`;
  const inspect = shell(
    runtime.command,
    [
      'image',
      'inspect',
      reference,
      '--format',
      '{{.Id}}\t{{index .Config.Labels "org.opencontainers.image.revision"}}\t{{join .RepoTags ","}}',
    ],
    { timeoutMs: 5 * 60 * 1000 },
  );

  const findings = [];
  let imageId = null;
  let revision = null;
  let repoTags = [];

  if (inspect.status !== 0) {
    findings.push(`image inspect failed with exit ${inspect.status}`);
  } else {
    const [id, rev, tags] = (inspect.stdout || '').trim().split('\t');
    imageId = id ?? null;
    revision = rev ?? null;
    repoTags = (tags || '').split(',').filter(Boolean);

    if (!/^sha256:[0-9a-f]{64}$/.test(imageId ?? '')) {
      findings.push(`image id is not a sha256 digest: ${imageId}`);
    }
    if (revision !== candidateSha) {
      findings.push(
        `image revision label is ${revision || '(none)'}, not the candidate ${candidateSha}`,
      );
    }
    const floating = repoTags.filter((tag) => FLOATING_TAG.test(tag));
    if (floating.length > 0) {
      findings.push(`image carries a floating tag: ${floating.join(', ')}`);
    }
  }

  const finishedAt = now();
  const result = {
    status: inspect.status,
    stdout: [
      inspect.stdout || '',
      '',
      `findings: ${findings.length ? findings.join('; ') : 'none'}`,
    ].join('\n'),
    stderr: inspect.stderr || '',
  };

  return {
    gateId: '20-image-inspection',
    description: 'Image digest captured by digest, never by floating tag',
    command: `${runtime.command} image inspect ${reference}`,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    exitCode: findings.length === 0 ? 0 : 1,
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    metrics: {
      imageId,
      revision,
      repoTags,
      findings,
    },
    logPath: writeLog(`${runLabel}-20-image-inspection`, 'image identity inspection', result),
  };
}
