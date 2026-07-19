import {
  startReadinessSchema,
  type RoleConfigurationInput,
  type StartReadiness,
  type StartReadinessIssue
} from "@werewolf/shared";

export function countConfiguredRoles(configuration: RoleConfigurationInput): number {
  return configuration.wolf
    + configuration.villager
    + configuration.seer
    + configuration.witch
    + (configuration.guard ?? 0)
    + (configuration.hunter ?? 0)
    + (configuration.idiot ?? 0);
}

export function evaluateStartReadiness(
  configuration: RoleConfigurationInput,
  participantCount: number
): StartReadiness {
  const configuredRoleCount = countConfiguredRoles(configuration);
  const issues: StartReadinessIssue[] = [];

  if (configuration.wolf < 1) {
    issues.push({ code: "WOLF_REQUIRED", message: "至少需要 1 名狼人" });
  }
  if (configuration.villager < 1) {
    issues.push({ code: "VILLAGER_REQUIRED", message: "至少需要 1 名村民" });
  }
  if (
    configuration.seer
    + configuration.witch
    + (configuration.guard ?? 0)
    + (configuration.hunter ?? 0)
    + (configuration.idiot ?? 0) < 1
  ) {
    issues.push({ code: "GOD_REQUIRED", message: "至少需要 1 名神职" });
  }
  if (configuredRoleCount !== participantCount) {
    issues.push({
      code: "ROLE_TOTAL_MISMATCH",
      message: `身份总数 ${configuredRoleCount} 必须等于参赛人数 ${participantCount}`
    });
  }

  return startReadinessSchema.parse({
    ready: issues.length === 0,
    participantCount,
    configuredRoleCount,
    issues
  });
}
