import { prisma } from '@/lib/prisma';

export type DiagnosticConfidence = 'CONFIRMED' | 'LIKELY' | 'UNKNOWN';

export interface DiagnosticResult {
  issueTitle: string;
  confidence: DiagnosticConfidence;
  rootCause: string;
  evidence: string[];
  recommendedAction: string;
  actionUrl?: string;
}

/**
 * 🎯 MULTI-STEP ROOT CAUSE DIAGNOSTIC ENGINE (Sections 16 & 17)
 * Runs deterministic diagnostic flows before invoking AI interpretation.
 */
export async function diagnoseOutboundEmailDelivery(params: {
  leadId: string;
  tenantId: string;
}): Promise<DiagnosticResult> {
  const { leadId, tenantId } = params;

  // Step 1: Check Lead
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: {
      id: true,
      email: true,
      emailInvalid: true,
      stage: true,
      assignedToId: true,
      sequenceId: true,
      sequenceStatus: true,
      assignedTo: { select: { id: true, email: true, isActive: true } },
    },
  });

  if (!lead) {
    return {
      issueTitle: 'Lead Not Found',
      confidence: 'CONFIRMED',
      rootCause: 'The specified lead does not exist in this tenant.',
      evidence: [`No lead record with ID ${leadId} in tenant ${tenantId}.`],
      recommendedAction: 'Verify lead ID or search leads pool.',
    };
  }

  // Step 2: Check Suppression / Unsubscribe
  if (lead.emailInvalid) {
    return {
      issueTitle: 'Email Suppressed / Invalid',
      confidence: 'CONFIRMED',
      rootCause: 'Outbound sending is permanently blocked by CRM suppression rules because the email was marked invalid or bounced.',
      evidence: [`Lead email '${lead.email}' has emailInvalid=true in database.`],
      recommendedAction: 'Update prospect email address or contact via phone.',
    };
  }

  // Step 3: Check Sequence Enrollment
  if (!lead.sequenceId) {
    return {
      issueTitle: 'Not Enrolled in Sequence',
      confidence: 'CONFIRMED',
      rootCause: 'Lead is not enrolled in an active cadence.',
      evidence: [`sequenceId is null on lead record.`],
      recommendedAction: 'Enroll lead into a campaign sequence.',
      actionUrl: `/leads/${lead.id}`,
    };
  }

  // Step 4: Check Sequence Status
  const sequence = await prisma.sequence.findFirst({
    where: { id: lead.sequenceId, tenantId },
    select: { id: true, name: true, isActive: true, isArchived: true },
  });

  if (!sequence || !sequence.isActive || sequence.isArchived) {
    return {
      issueTitle: 'Sequence Paused or Archived',
      confidence: 'CONFIRMED',
      rootCause: `Sequence '${sequence?.name || 'Unknown'}' is currently paused or archived. Scheduled steps will not dispatch.`,
      evidence: [`Sequence isActive=${sequence?.isActive}, isArchived=${sequence?.isArchived}.`],
      recommendedAction: 'Activate sequence in Sequences panel.',
      actionUrl: `/sequences`,
    };
  }

  // Step 5: Check Mailbox Connection
  const mailbox = await prisma.emailAccount.findFirst({
    where: { tenantId, userId: lead.assignedToId },
    select: { id: true, email: true, isActive: true, sendPausedAt: true },
  });

  if (!mailbox || !mailbox.isActive || mailbox.sendPausedAt) {
    return {
      issueTitle: 'Sender Mailbox Paused or Disconnected',
      confidence: 'CONFIRMED',
      rootCause: `Assigned rep's mailbox (${mailbox?.email || lead.assignedTo.email}) is paused or inactive. Worker cannot dispatch outbound mail.`,
      evidence: [`EmailAccount isActive=${mailbox?.isActive}, sendPausedAt=${mailbox?.sendPausedAt?.toISOString() || 'null'}.`],
      recommendedAction: 'Check mailbox settings in Settings -> Email Accounts.',
      actionUrl: `/settings?tab=email`,
    };
  }

  // Fallback: Cadence is active and running
  return {
    issueTitle: 'Sequence Healthy & In Flight',
    confidence: 'CONFIRMED',
    rootCause: 'All prerequisites are satisfied. Sequence step is waiting for its scheduled delivery window.',
    evidence: [
      `Lead ${lead.email} valid.`,
      `Sequence ${sequence.name} active.`,
      `Mailbox ${mailbox.email} connected.`,
    ],
    recommendedAction: 'No intervention required. Automation is executing normally.',
  };
}
