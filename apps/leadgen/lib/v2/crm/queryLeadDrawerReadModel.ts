import "server-only";

import { traceQuery, withSpan } from "@/lib/v2/observability/trace";
import { queryLeadEnrollments } from "../outreach/sequences/queryEnrollment";
import { queryLeadNotes, queryLeadTasks } from "./leadDesk";
import { getContactDetail } from "./queryContacts";
import { queryLeadTimeline } from "./queryLeadTimeline";
import { getLeadWorkspaceDetail } from "./queryLeadWorkspace";
import { queryAssignableMembers } from "./queryAssignedLeads";

// P5: the SINGLE drawer read-model. Bundles the per-lead detail queries the leads page
// currently runs inline (on every server navigation) into one tenant-scoped call, so a
// client-side drawer can open instantly from a row snapshot and hydrate via one fetch.
// Reuses the existing queries verbatim — no behavior drift, just one entry point.

export type LeadDrawerReadModel = {
  leadAssignmentId: string;
  detail: NonNullable<Awaited<ReturnType<typeof getLeadWorkspaceDetail>>>;
  contactDetail: Awaited<ReturnType<typeof getContactDetail>> | null;
  timeline: Awaited<ReturnType<typeof queryLeadTimeline>>;
  enrollments: Awaited<ReturnType<typeof queryLeadEnrollments>>;
  notes: Awaited<ReturnType<typeof queryLeadNotes>>;
  tasks: Awaited<ReturnType<typeof queryLeadTasks>>;
  assignableMembers: Awaited<ReturnType<typeof queryAssignableMembers>>;
};

export async function queryLeadDrawerReadModel(input: {
  organizationId: string;
  leadAssignmentId: string;
}): Promise<LeadDrawerReadModel | null> {
  return withSpan("lead.drawer", async () => {
  const { organizationId, leadAssignmentId } = input;
  const detail = await traceQuery("lead.drawer.detail", () => getLeadWorkspaceDetail({ organizationId, leadAssignmentId }));
  if (!detail) return null;

  const contactId = (detail as { contactId?: string | null }).contactId ?? null;
  const [timeline, enrollments, contactDetail, notes, tasks, assignableMembers] = await traceQuery("lead.drawer.related", () => Promise.all([
    queryLeadTimeline({ organizationId, leadAssignmentId, limit: 50 }),
    queryLeadEnrollments(organizationId, leadAssignmentId),
    contactId ? getContactDetail(organizationId, contactId) : Promise.resolve(null),
    queryLeadNotes(organizationId, leadAssignmentId),
    queryLeadTasks(organizationId, leadAssignmentId),
    queryAssignableMembers(organizationId),
  ]));

  return { leadAssignmentId, detail, contactDetail, timeline, enrollments, notes, tasks, assignableMembers };
  });
}
