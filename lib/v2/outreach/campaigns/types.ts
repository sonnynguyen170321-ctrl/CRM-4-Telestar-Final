export const V2_CAMPAIGN_SCHEDULE_SCHEMA_VERSION = "v2.campaign-schedule.v1" as const;
export const V2_OUTREACH_PROFILE_SCHEMA_VERSION = "v2.outreach-profile.v1" as const;
export const V2_ENROLLMENT_SNAPSHOT_SCHEMA_VERSION = "v2.enrollment-snapshot.v1" as const;

export type V2CampaignTimezoneMode = "LEAD" | "CAMPAIGN" | "ORGANIZATION";

export type V2CampaignScheduleV1 = {
  schemaVersion: typeof V2_CAMPAIGN_SCHEDULE_SCHEMA_VERSION;
  weekdays: Array<1 | 2 | 3 | 4 | 5 | 6 | 7>;
  startLocalTime: string;
  endLocalTime: string;
};

export type V2LeadOutreachMergeDataV1 = {
  schemaVersion: typeof V2_OUTREACH_PROFILE_SCHEMA_VERSION;
  predefined: Record<string, string | null>;
  custom: Record<string, string | number | boolean | null>;
};

export type V2EnrollmentRenderSnapshotV1 = {
  schemaVersion: typeof V2_ENROLLMENT_SNAPSHOT_SCHEMA_VERSION;
  recipientEmail: string;
  timezone: string;
  mergeData: V2LeadOutreachMergeDataV1;
};

export type V2CampaignReadinessBlockerCode =
  | "NO_VALID_EMAIL_LEADS"
  | "SUPPRESSED_LEADS_SELECTED"
  | "QUALIFICATION_OVERRIDE_REQUIRED"
  | "NO_EMAIL_STEP"
  | "REQUIRED_TEMPLATE_VALUE_MISSING"
  | "NO_HEALTHY_LIVE_SENDER"
  | "INVALID_SCHEDULE"
  | "WORKER_HEARTBEAT_STALE"
  | "IMAP_HEARTBEAT_STALE"
  | "TRACKING_DOMAIN_UNVERIFIED"
  | "GLOBAL_KILL_SWITCH_ENABLED";
