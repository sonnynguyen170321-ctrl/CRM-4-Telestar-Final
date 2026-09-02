import type {
  ActivityChannel,
  ActivityOutcome,
  ActivityType,
  ImportRowKind,
  RawActivityRecapRow,
  TimestampQuality,
  WideRowChannelMapping,
} from "../types";

export type SampleActivityRowFixture = {
  name: string;
  rawRow: RawActivityRecapRow;
  expected: {
    channel: ActivityChannel;
    activityType: ActivityType;
    outcome: ActivityOutcome;
    warningCodes?: string[];
  };
};

export type SampleActivityExpansionFixture = {
  name: string;
  rawRow: RawActivityRecapRow;
  importRowKind: ImportRowKind;
  wideRowChannelMappings?: WideRowChannelMapping[];
  expected: {
    eventCount: number;
    requiresManagerReview: boolean;
    warningCodes?: string[];
    eventExpectations?: Array<{
      channel: ActivityChannel;
      activityType: ActivityType;
      outcome: ActivityOutcome;
      timestampQuality: TimestampQuality;
      eventIndexWithinRow: number;
    }>;
  };
};

export const SAMPLE_ACTIVITY_ROW_FIXTURES: SampleActivityRowFixture[] = [
  {
    name: "email positive response",
    rawRow: {
      Date: " 2026-06-01 ",
      SDR: " Mina ",
      Company: " BrightWave ",
      Website: " https://brightwave.example ",
      Contact: " Ada Lovelace ",
      Email: " ada@brightwave.example ",
      Channel: "mail",
      Status: "Positive reply",
      Notes: "Asked for details",
    },
    expected: {
      channel: "email",
      activityType: "positive_reply",
      outcome: "positive_response",
    },
  },
  {
    name: "linkedin connection message",
    rawRow: {
      "Activity Date": "2026-06-02",
      Owner: "Nok",
      "Company Name": "Northstar AI",
      LinkedIn: "https://linkedin.com/in/northstar-buyer",
      Channel: "LI",
      Result: "Connection request sent",
      Comment: "Included industry note",
    },
    expected: {
      channel: "linkedin",
      activityType: "linkedin_connection",
      outcome: "unknown",
      warningCodes: ["unknown_outcome"],
    },
  },
  {
    name: "call no pick up",
    rawRow: {
      date: "2026-06-03",
      rep: "Jo",
      company: "Cloud Ledger",
      phone: "+66 2 000 0000",
      channel: "cold call",
      status: "No pick up",
      remarks: "Try again next week",
    },
    expected: {
      channel: "call",
      activityType: "no_pick_up",
      outcome: "no_pick_up",
    },
  },
  {
    name: "whatsapp follow up needed",
    rawRow: {
      date: "2026-06-04",
      sdr: "Pim",
      company: "Retail Stack",
      channel: "WA",
      result: "WhatsApp message follow-up needed",
      note: "Asked to send deck",
    },
    expected: {
      channel: "whatsapp",
      activityType: "whatsapp_message",
      outcome: "follow_up_needed",
    },
  },
  {
    name: "meeting booked",
    rawRow: {
      date: "2026-06-05",
      owner: "Tan",
      company: "SecureOps",
      channel: "meet",
      status: "Meeting booked",
      notes: "Tuesday demo",
    },
    expected: {
      channel: "meeting",
      activityType: "meeting_booked",
      outcome: "meeting_booked",
    },
  },
  {
    name: "bounced wrong contact",
    rawRow: {
      date: "2026-06-06",
      sdr: "May",
      company: "DataWorks",
      email: "old-contact@dataworks.example",
      channel: "email",
      status: "Bounced",
      note: "Wrong contact",
    },
    expected: {
      channel: "email",
      activityType: "new_email",
      outcome: "bounced",
    },
  },
  {
    name: "unknown ambiguous row",
    rawRow: {
      date: "2026-06-07",
      user: "Lee",
      company: "Unknown Co",
      channel: "unknown channel",
      status: "Maybe later somehow",
      note: "",
    },
    expected: {
      channel: "other",
      activityType: "other",
      outcome: "unknown",
      warningCodes: [
        "unknown_channel",
        "unknown_activity_type",
        "unknown_outcome",
      ],
    },
  },
];

export const SAMPLE_ACTIVITY_EXPANSION_FIXTURES: SampleActivityExpansionFixture[] = [
  {
    name: "lead snapshot creates no activity events",
    rawRow: {
      Company: "Prospect Co",
      Website: "https://prospect.example",
      Contact: "Mai Tran",
      Email: "mai@prospect.example",
      Stage: "New Contacts",
    },
    importRowKind: "lead_snapshot",
    expected: {
      eventCount: 0,
      requiresManagerReview: false,
      warningCodes: ["lead_snapshot_does_not_create_activity_events"],
    },
  },
  {
    name: "activity event expands to one event",
    rawRow: {
      Date: "2026-06-08 09:30",
      SDR: "Mina",
      Company: "BrightWave",
      Channel: "email",
      Status: "Positive reply",
      Notes: "Initial outreach",
    },
    importRowKind: "activity_event",
    expected: {
      eventCount: 1,
      requiresManagerReview: false,
      eventExpectations: [
        {
          channel: "email",
          activityType: "positive_reply",
          outcome: "positive_response",
          timestampQuality: "exact_datetime",
          eventIndexWithinRow: 0,
        },
      ],
    },
  },
  {
    name: "wide activity bundle expands to multiple events",
    rawRow: {
      Company: "Wide Co",
      Contact: "Nok S",
      "Email Stage": "Positive reply",
      "Email Date": "2026-06-09",
      "Call Stage": "Calls No Pickup",
      "Call Date": "2026-06-09 10:00",
      "LinkedIn Stage": "",
      "LinkedIn Date": "",
    },
    importRowKind: "wide_activity_bundle",
    wideRowChannelMappings: [
      {
        channel: "email",
        stageColumn: "Email Stage",
        dateColumn: "Email Date",
      },
      {
        channel: "call",
        stageColumn: "Call Stage",
        dateColumn: "Call Date",
      },
      {
        channel: "linkedin",
        stageColumn: "LinkedIn Stage",
        dateColumn: "LinkedIn Date",
      },
    ],
    expected: {
      eventCount: 2,
      requiresManagerReview: false,
      eventExpectations: [
        {
          channel: "email",
          activityType: "positive_reply",
          outcome: "positive_response",
          timestampQuality: "date_only",
          eventIndexWithinRow: 0,
        },
        {
          channel: "call",
          activityType: "no_pick_up",
          outcome: "no_pick_up",
          timestampQuality: "exact_datetime",
          eventIndexWithinRow: 1,
        },
      ],
    },
  },
  {
    name: "pipeline snapshot does not reconstruct history",
    rawRow: {
      Company: "Pipe Co",
      Stage: "SQL",
      "Last Activity Time": "2026-06-10",
      "Modified Time": "2026-06-11",
    },
    importRowKind: "pipeline_snapshot",
    expected: {
      eventCount: 0,
      requiresManagerReview: false,
      warningCodes: ["pipeline_snapshot_does_not_reconstruct_full_history"],
    },
  },
  {
    name: "meeting tracker expansion deferred",
    rawRow: {
      Company: "Meeting Co",
      "Date Book": "2026-06-12",
      "Date Happen": "2026-06-15",
      Status: "Meeting booked",
    },
    importRowKind: "meeting_tracker",
    expected: {
      eventCount: 0,
      requiresManagerReview: false,
      warningCodes: ["meeting_tracker_expansion_deferred"],
    },
  },
  {
    name: "unknown mixed requires manager review",
    rawRow: {
      Company: "Ambiguous Co",
      Stage: "LI sent",
    },
    importRowKind: "unknown_mixed",
    expected: {
      eventCount: 0,
      requiresManagerReview: true,
      warningCodes: ["user_profile_confirmation_required"],
    },
  },
  {
    name: "wide activity missing timestamp creates review warning",
    rawRow: {
      Company: "Missing Date Co",
      "Email Stage": "1st Email Sent",
    },
    importRowKind: "wide_activity_bundle",
    wideRowChannelMappings: [
      {
        channel: "email",
        stageColumn: "Email Stage",
        dateColumn: "Email Date",
      },
    ],
    expected: {
      eventCount: 1,
      requiresManagerReview: true,
      warningCodes: ["missing_timestamp"],
      eventExpectations: [
        {
          channel: "email",
          activityType: "new_email",
          outcome: "unknown",
          timestampQuality: "missing",
          eventIndexWithinRow: 0,
        },
      ],
    },
  },
  {
    name: "wide activity conflicting timestamp creates review warning",
    rawRow: {
      Company: "Conflict Date Co",
      "Email Stage": "1st Email Sent",
      "Email Date": ["2026-06-16", "2026-06-17"],
    },
    importRowKind: "wide_activity_bundle",
    wideRowChannelMappings: [
      {
        channel: "email",
        stageColumn: "Email Stage",
        dateColumn: "Email Date",
      },
    ],
    expected: {
      eventCount: 1,
      requiresManagerReview: true,
      warningCodes: ["conflicting_timestamp"],
      eventExpectations: [
        {
          channel: "email",
          activityType: "new_email",
          outcome: "unknown",
          timestampQuality: "conflicting",
          eventIndexWithinRow: 0,
        },
      ],
    },
  },
  {
    name: "event index prevents same event hash collision",
    rawRow: {
      Company: "Collision Co",
      "Email Stage A": "Positive reply",
      "Email Date A": "2026-06-18",
      "Email Stage B": "Positive reply",
      "Email Date B": "2026-06-18",
    },
    importRowKind: "wide_activity_bundle",
    wideRowChannelMappings: [
      {
        channel: "email",
        stageColumn: "Email Stage A",
        dateColumn: "Email Date A",
        sourceColumnName: "Email Stage",
      },
      {
        channel: "email",
        stageColumn: "Email Stage B",
        dateColumn: "Email Date B",
        sourceColumnName: "Email Stage",
      },
    ],
    expected: {
      eventCount: 2,
      requiresManagerReview: false,
      eventExpectations: [
        {
          channel: "email",
          activityType: "positive_reply",
          outcome: "positive_response",
          timestampQuality: "date_only",
          eventIndexWithinRow: 0,
        },
        {
          channel: "email",
          activityType: "positive_reply",
          outcome: "positive_response",
          timestampQuality: "date_only",
          eventIndexWithinRow: 1,
        },
      ],
    },
  },
];
