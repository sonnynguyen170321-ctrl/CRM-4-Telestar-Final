"use server";

import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant";
import {
  createLeadNote,
  createLeadTask,
  completeLeadTask,
  logLeadActivity,
  overrideLeadQualification,
  type LeadDeskDb,
} from "@/lib/v2/crm";

// Contacts & Leads desk Quick Actions. Gated on workflow.update (an SDR works their own
// leads). Each verifies the lead is in-org + audits inside the lib; the action only
// authenticates, forwards, and persists — NO revalidatePath. The lead drawer applies the
// change optimistically and silently re-fetches its own read-model to reconcile, so a note /
// task / qualify feels instant instead of triggering a full priority-ranked page re-render.
// Real DB writes — no demo data.

function field(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

export async function addLeadNoteAction(formData: FormData) {
  let ctx;
  try {
    ctx = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const leadAssignmentId = field(formData, "leadAssignmentId");
  const body = field(formData, "body");
  if (!leadAssignmentId || !body) return;
  await createLeadNote(prisma as unknown as LeadDeskDb, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    leadAssignmentId,
    body,
  });
}

export async function createLeadTaskAction(formData: FormData) {
  let ctx;
  try {
    ctx = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const leadAssignmentId = field(formData, "leadAssignmentId");
  const title = field(formData, "title");
  if (!leadAssignmentId || !title) return;
  await createLeadTask(prisma as unknown as LeadDeskDb, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    leadAssignmentId,
    title,
    detail: field(formData, "detail") || null,
    dueAt: field(formData, "dueAt") || null,
    ownerUserId: field(formData, "ownerUserId") || null,
  });
}

export async function completeLeadTaskAction(formData: FormData) {
  let ctx;
  try {
    ctx = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const taskId = field(formData, "taskId");
  if (!taskId) return;
  await completeLeadTask(prisma as unknown as LeadDeskDb, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    taskId,
  });
}

export async function logLeadActivityAction(formData: FormData) {
  let ctx;
  try {
    ctx = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const leadAssignmentId = field(formData, "leadAssignmentId");
  const channel = field(formData, "channel");
  if (!leadAssignmentId || !channel) return;
  await logLeadActivity(prisma as unknown as LeadDeskDb, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    leadAssignmentId,
    channel,
    outcome: field(formData, "outcome") || null,
    note: field(formData, "note") || null,
  });
}

export async function overrideLeadQualificationAction(formData: FormData) {
  let ctx;
  try {
    ctx = await requirePermission("workflow.update");
  } catch {
    return;
  }
  const leadAssignmentId = field(formData, "leadAssignmentId");
  const qualification = field(formData, "qualification"); // 'QUALIFIED' | 'UNQUALIFIED'
  if (!leadAssignmentId || !qualification) return;

  await overrideLeadQualification(prisma as unknown as LeadDeskDb, {
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    leadAssignmentId,
    qualification,
  });
}

import { safeFetch } from "@telestar/core-search/safeFetch";
import { checkEmailRegistration, type HoleheResult } from "@/lib/v2/enrich/holehe";
import { analyzePhoneNumber } from "@/lib/v2/enrich/phoneinfoga";
import { detectTechnologies } from "@/lib/v2/enrich/spiderfoot";

export async function runDiagnosticProbeAction(formData: FormData) {
  try {
    await requirePermission("workflow.update");
  } catch {
    return { error: "Denied permission." };
  }

  const domain = field(formData, "domain");
  const email = field(formData, "email");
  const phone = field(formData, "phone");

  // 1. Quét công nghệ website (Spiderfoot)
  let techStack: string[] = [];
  if (domain) {
    try {
      const url = domain.startsWith("http") ? domain : `https://${domain}`;
      const res = await safeFetch(url, {
        method: "GET",
        headers: { "user-agent": "Mozilla/5.0 (compatible; LeadgerResearchBot/1.0)" }
      });
      if (res.ok) {
        const text = await res.response.text();
        techStack = detectTechnologies(text).technologies;
      }
    } catch {}
  }

  // 2. Kiểm tra đăng ký email (Holehe)
  let holeheResults: HoleheResult[] = [];
  if (email) {
    try {
      holeheResults = await checkEmailRegistration(email);
    } catch {}
  }

  // 3. Phân tích số điện thoại (PhoneInfoga)
  let phoneIntel = null;
  if (phone) {
    try {
      phoneIntel = analyzePhoneNumber(phone);
    } catch {}
  }

  return {
    success: true,
    techStack,
    holeheResults,
    phoneIntel,
  };
}

