import { describe, expect, it } from "vitest";

import { scoreLead } from "@/lib/leads/scoring";

describe("scoreLead engagement compatibility adapter", () => {
  it("uses only observed activity for the visible priority", () => {
    expect(
      scoreLead({
        title: "CEO",
        phone: "+84 900 000 000",
        emailValidation: "valid",
      }),
    ).toMatchObject({
      score: 0,
      label: "cold",
    });
    expect(scoreLead({ emailOpenCount: 1 })).toMatchObject({
      score: 10,
      label: "warm",
    });
    expect(scoreLead({ emailReplyCount: 1 })).toMatchObject({
      score: 80,
      label: "hot",
    });
    expect(scoreLead({ meetings: [{ id: "meeting-1" }] })).toMatchObject({
      score: 100,
      label: "hot",
    });
  });

  it("does not mix workflow stage, manual priority or overdue tasks into engagement", () => {
    const result = scoreLead({
      stage: "won",
      crmPriorityScore: "hot",
      title: "Founder",
      tasks: [{ status: "pending", dueDate: new Date(0) }],
    });
    expect(result).toMatchObject({ score: 0, label: "cold", insights: [] });
  });
});
