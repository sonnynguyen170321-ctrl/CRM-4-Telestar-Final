import { describe, expect, it } from "vitest";

import { discoverPeopleAtCompany, extractLinkedInPeopleFromText, isTargetTitle } from "../peopleDiscovery";

describe("people discovery", () => {
  it("rejects assistant/context-only title matches", () => {
    expect(isTargetTitle("Assistant to CEO")).toBe(false);
    expect(isTargetTitle("Executive Assistant")).toBe(false);
    expect(isTargetTitle("Office of the CEO")).toBe(false);
    expect(isTargetTitle("VP Sales")).toBe(true);
    expect(isTargetTitle("Head of Revenue Operations")).toBe(true);
  });

  it("extracts public LinkedIn snippet people with strict titles", () => {
    const people = extractLinkedInPeopleFromText(
      "Jane Doe - VP Sales at Acme | LinkedIn. Sam Helper - Assistant to CEO at Acme | LinkedIn.",
      "Acme",
      "https://www.linkedin.com/in/jane-doe"
    );

    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      name: "Jane Doe",
      title: "VP Sales",
      companyName: "Acme",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe",
      reason: "linkedin_public_snippet",
    });
  });

  it("turns company page team hints into linked contact candidates", () => {
    const people = discoverPeopleAtCompany({
      companyName: "Acme",
      companyCandidateId: "rc_1",
      domain: "acme.com",
      sourceCoverage: {
        teamHints: [
          { name: "Jane Doe", title: "Chief Revenue Officer", sourceUrl: "https://acme.com/team" },
          { name: "Sam Helper", title: "Assistant to CEO", sourceUrl: "https://acme.com/team" },
        ],
      },
    });

    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: "Jane Doe", title: "Chief Revenue Officer", reason: "company_page_team_hint" });
  });
});
