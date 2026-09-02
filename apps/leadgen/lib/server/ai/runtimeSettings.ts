import {
  getSafeAiStatus,
  parseScoringMode,
  type AiRuntimeOverrides,
  type AiScoringMode,
} from "@/lib/server/ai/config";
import { prisma } from "@/lib/server/prisma";

const runtimeSettingId = "default";

export type AiRuntimeSettingInput = {
  enabled: boolean;
  scoringMode: Exclude<AiScoringMode, "disabled">;
  maxRowsPerUpload: number;
};

export async function getAiRuntimeSetting() {
  return prisma.aiRuntimeSetting.findUnique({
    where: { id: runtimeSettingId },
  });
}

export async function getEffectiveAiStatus() {
  const setting = await getAiRuntimeSetting();

  return getSafeAiStatus(buildRuntimeOverrides(setting));
}

export async function updateAiRuntimeSetting(input: AiRuntimeSettingInput) {
  const setting = await prisma.aiRuntimeSetting.upsert({
    where: { id: runtimeSettingId },
    create: {
      id: runtimeSettingId,
      enabled: input.enabled,
      scoringMode: input.scoringMode,
      maxRowsPerUpload: input.maxRowsPerUpload,
    },
    update: {
      enabled: input.enabled,
      scoringMode: input.scoringMode,
      maxRowsPerUpload: input.maxRowsPerUpload,
    },
  });

  return {
    setting,
    status: getSafeAiStatus(buildRuntimeOverrides(setting)),
  };
}

function buildRuntimeOverrides(
  setting: Awaited<ReturnType<typeof getAiRuntimeSetting>>
): AiRuntimeOverrides {
  if (!setting) {
    return {};
  }

  return {
    enabled: setting.enabled,
    scoringMode: setting.scoringMode
      ? parseScoringMode(setting.scoringMode)
      : null,
    maxRowsPerUpload: setting.maxRowsPerUpload,
  };
}
