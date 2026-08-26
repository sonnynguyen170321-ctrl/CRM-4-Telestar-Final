-- DropForeignKey
ALTER TABLE "AbTestVariant" DROP CONSTRAINT "AbTestVariant_templateId_fkey";

-- DropForeignKey
ALTER TABLE "AccountPainHypothesis" DROP CONSTRAINT "AccountPainHypothesis_accountId_fkey";

-- DropForeignKey
ALTER TABLE "AccountPainHypothesis" DROP CONSTRAINT "AccountPainHypothesis_aiCallId_fkey";

-- DropForeignKey
ALTER TABLE "AccountPainHypothesis" DROP CONSTRAINT "AccountPainHypothesis_cacheId_fkey";

-- DropForeignKey
ALTER TABLE "AccountPainHypothesis" DROP CONSTRAINT "AccountPainHypothesis_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "AccountResearchCache" DROP CONSTRAINT "AccountResearchCache_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "Activity" DROP CONSTRAINT "Activity_userId_fkey";

-- DropForeignKey
ALTER TABLE "AgentAction" DROP CONSTRAINT "AgentAction_playbookVersionId_fkey";

-- DropForeignKey
ALTER TABLE "AgentAction" DROP CONSTRAINT "AgentAction_userId_fkey";

-- DropForeignKey
ALTER TABLE "AgentAction" DROP CONSTRAINT "AgentAction_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_agentActionId_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_playbookVersionId_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "AgentApprovalRequest" DROP CONSTRAINT "AgentApprovalRequest_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "AiCall" DROP CONSTRAINT "AiCall_agentActionId_fkey";

-- DropForeignKey
ALTER TABLE "AiCall" DROP CONSTRAINT "AiCall_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "AiMemory" DROP CONSTRAINT "AiMemory_userId_fkey";

-- DropForeignKey
ALTER TABLE "ApiKey" DROP CONSTRAINT "ApiKey_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_templateId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "BookingLink" DROP CONSTRAINT "BookingLink_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "BookingLink" DROP CONSTRAINT "BookingLink_clientId_fkey";

-- DropForeignKey
ALTER TABLE "BookingLink" DROP CONSTRAINT "BookingLink_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_clientId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignLeadRequirement" DROP CONSTRAINT "CampaignLeadRequirement_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignLeadRequirement" DROP CONSTRAINT "CampaignLeadRequirement_createdById_fkey";

-- DropForeignKey
ALTER TABLE "CampaignPlaybook" DROP CONSTRAINT "CampaignPlaybook_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignPlaybook" DROP CONSTRAINT "CampaignPlaybook_currentVersionId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignPlaybookVersion" DROP CONSTRAINT "CampaignPlaybookVersion_fromProposalId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignPlaybookVersion" DROP CONSTRAINT "CampaignPlaybookVersion_playbookId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignSdr" DROP CONSTRAINT "CampaignSdr_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignSdr" DROP CONSTRAINT "CampaignSdr_userId_fkey";

-- DropForeignKey
ALTER TABLE "ClientReport" DROP CONSTRAINT "ClientReport_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "ClientReport" DROP CONSTRAINT "ClientReport_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "ClientReport" DROP CONSTRAINT "ClientReport_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientReport" DROP CONSTRAINT "ClientReport_generatedById_fkey";

-- DropForeignKey
ALTER TABLE "ClientReportExport" DROP CONSTRAINT "ClientReportExport_exportedById_fkey";

-- DropForeignKey
ALTER TABLE "ClientReportExport" DROP CONSTRAINT "ClientReportExport_reportId_fkey";

-- DropForeignKey
ALTER TABLE "ClientReportRecipient" DROP CONSTRAINT "ClientReportRecipient_reportId_fkey";

-- DropForeignKey
ALTER TABLE "ClientReportShareLink" DROP CONSTRAINT "ClientReportShareLink_createdById_fkey";

-- DropForeignKey
ALTER TABLE "ClientReportShareLink" DROP CONSTRAINT "ClientReportShareLink_reportId_fkey";

-- DropForeignKey
ALTER TABLE "CompanySignal" DROP CONSTRAINT "CompanySignal_accountId_fkey";

-- DropForeignKey
ALTER TABLE "CompanySignal" DROP CONSTRAINT "CompanySignal_aiCallId_fkey";

-- DropForeignKey
ALTER TABLE "CompanySignal" DROP CONSTRAINT "CompanySignal_cacheId_fkey";

-- DropForeignKey
ALTER TABLE "CompanySignal" DROP CONSTRAINT "CompanySignal_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_activityId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_capturedById_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_contactId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_leadId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "ContactEvidence" DROP CONSTRAINT "ContactEvidence_supersedesId_fkey";

-- DropForeignKey
ALTER TABLE "ContactIntelligence" DROP CONSTRAINT "ContactIntelligence_contactId_fkey";

-- DropForeignKey
ALTER TABLE "ContactIntelligence" DROP CONSTRAINT "ContactIntelligence_relationshipOwnerId_fkey";

-- DropForeignKey
ALTER TABLE "ContactResearchCache" DROP CONSTRAINT "ContactResearchCache_contactId_fkey";

-- DropForeignKey
ALTER TABLE "EmailAccount" DROP CONSTRAINT "EmailAccount_userId_fkey";

-- DropForeignKey
ALTER TABLE "EmailHealthAlert" DROP CONSTRAINT "EmailHealthAlert_accountId_fkey";

-- DropForeignKey
ALTER TABLE "EmailHealthAlert" DROP CONSTRAINT "EmailHealthAlert_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "EmailHealthSnapshot" DROP CONSTRAINT "EmailHealthSnapshot_accountId_fkey";

-- DropForeignKey
ALTER TABLE "EmailHealthSnapshot" DROP CONSTRAINT "EmailHealthSnapshot_userId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "ImportBatch" DROP CONSTRAINT "ImportBatch_userId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRow" DROP CONSTRAINT "ImportRow_batchId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRow" DROP CONSTRAINT "ImportRow_leadId_fkey";

-- DropForeignKey
ALTER TABLE "ImportRow" DROP CONSTRAINT "ImportRow_poolItemId_fkey";

-- DropForeignKey
ALTER TABLE "InboundMessage" DROP CONSTRAINT "InboundMessage_accountId_fkey";

-- DropForeignKey
ALTER TABLE "InboundMessage" DROP CONSTRAINT "InboundMessage_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_contactId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_accountId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_assignedById_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_assignedCampaignId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_assignedSdrId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_contactId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_convertedLeadId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_duplicateOfId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_importBatchId_fkey";

-- DropForeignKey
ALTER TABLE "LeadPoolItem" DROP CONSTRAINT "LeadPoolItem_qualifiedById_fkey";

-- DropForeignKey
ALTER TABLE "LeadgenActivity" DROP CONSTRAINT "LeadgenActivity_poolItemId_fkey";

-- DropForeignKey
ALTER TABLE "LeadgenActivity" DROP CONSTRAINT "LeadgenActivity_userId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_bookingLinkId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_outcomeLoggedById_fkey";

-- DropForeignKey
ALTER TABLE "Meeting" DROP CONSTRAINT "Meeting_sdrId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_accountId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_contactId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_meetingId_fkey";

-- DropForeignKey
ALTER TABLE "Opportunity" DROP CONSTRAINT "Opportunity_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "OpportunityActivity" DROP CONSTRAINT "OpportunityActivity_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "OpportunityActivity" DROP CONSTRAINT "OpportunityActivity_userId_fkey";

-- DropForeignKey
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_abVariantId_fkey";

-- DropForeignKey
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_accountId_fkey";

-- DropForeignKey
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_leadId_fkey";

-- DropForeignKey
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_templateId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalizationHook" DROP CONSTRAINT "PersonalizationHook_accountId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalizationHook" DROP CONSTRAINT "PersonalizationHook_aiCallId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalizationHook" DROP CONSTRAINT "PersonalizationHook_cacheId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalizationHook" DROP CONSTRAINT "PersonalizationHook_contactId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalizationHook" DROP CONSTRAINT "PersonalizationHook_leadId_fkey";

-- DropForeignKey
ALTER TABLE "PersonalizationHook" DROP CONSTRAINT "PersonalizationHook_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "PlaybookProposal" DROP CONSTRAINT "PlaybookProposal_basedOnVersionId_fkey";

-- DropForeignKey
ALTER TABLE "PlaybookProposal" DROP CONSTRAINT "PlaybookProposal_playbookId_fkey";

-- DropForeignKey
ALTER TABLE "ProspectTransition" DROP CONSTRAINT "ProspectTransition_leadId_fkey";

-- DropForeignKey
ALTER TABLE "ProspectTransition" DROP CONSTRAINT "ProspectTransition_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Reminder" DROP CONSTRAINT "Reminder_userId_fkey";

-- DropForeignKey
ALTER TABLE "Sequence" DROP CONSTRAINT "Sequence_createdById_fkey";

-- DropForeignKey
ALTER TABLE "SequenceDraftRecord" DROP CONSTRAINT "SequenceDraftRecord_draftedById_fkey";

-- DropForeignKey
ALTER TABLE "SequenceDraftRecord" DROP CONSTRAINT "SequenceDraftRecord_leadId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceEnrollment" DROP CONSTRAINT "SequenceEnrollment_leadId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceEnrollment" DROP CONSTRAINT "SequenceEnrollment_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceLaunch" DROP CONSTRAINT "SequenceLaunch_leadId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceLaunch" DROP CONSTRAINT "SequenceLaunch_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceLaunch" DROP CONSTRAINT "SequenceLaunch_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceStep" DROP CONSTRAINT "SequenceStep_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceStep" DROP CONSTRAINT "SequenceStep_templateId_fkey";

-- DropForeignKey
ALTER TABLE "SequenceStepCopy" DROP CONSTRAINT "SequenceStepCopy_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "SequenceStepCopy" DROP CONSTRAINT "SequenceStepCopy_enrollmentId_fkey";

-- DropForeignKey
ALTER TABLE "SuppressionEntry" DROP CONSTRAINT "SuppressionEntry_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_userId_fkey";

-- DropForeignKey
ALTER TABLE "Template" DROP CONSTRAINT "Template_createdById_fkey";

-- DropForeignKey
ALTER TABLE "TenantAiBudgetReservation" DROP CONSTRAINT "TenantAiBudgetReservation_periodId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_managerId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_createdById_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_leadId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrder" DROP CONSTRAINT "WorkOrder_playbookVersionId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrderLease" DROP CONSTRAINT "WorkOrderLease_leadId_fkey";

-- DropForeignKey
ALTER TABLE "WorkOrderLease" DROP CONSTRAINT "WorkOrderLease_workOrderId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "AbTestVariant_id_tenantId_key" ON "AbTestVariant"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_id_tenantId_key" ON "Account"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountResearchCache_id_tenantId_key" ON "AccountResearchCache"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountResearchCache_accountId_tenantId_key" ON "AccountResearchCache"("accountId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_id_tenantId_key" ON "Activity"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_id_tenantId_key" ON "AgentAction"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCall_id_tenantId_key" ON "AiCall"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_id_tenantId_key" ON "BookingLink"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_id_tenantId_key" ON "Campaign"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlaybook_id_tenantId_key" ON "CampaignPlaybook"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlaybook_campaignId_tenantId_key" ON "CampaignPlaybook"("campaignId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlaybook_currentVersionId_tenantId_key" ON "CampaignPlaybook"("currentVersionId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlaybookVersion_id_tenantId_key" ON "CampaignPlaybookVersion"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPlaybookVersion_fromProposalId_tenantId_key" ON "CampaignPlaybookVersion"("fromProposalId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_id_tenantId_key" ON "Client"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientReport_id_tenantId_key" ON "ClientReport"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_id_tenantId_key" ON "Contact"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEvidence_id_tenantId_key" ON "ContactEvidence"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIntelligence_contactId_tenantId_key" ON "ContactIntelligence"("contactId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactResearchCache_id_tenantId_key" ON "ContactResearchCache"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactResearchCache_contactId_tenantId_key" ON "ContactResearchCache"("contactId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccount_id_tenantId_key" ON "EmailAccount"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_id_tenantId_key" ON "ImportBatch"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_tenantId_key" ON "Lead"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPoolItem_id_tenantId_key" ON "LeadPoolItem"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_id_tenantId_key" ON "Meeting"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_id_tenantId_key" ON "Opportunity"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_meetingId_tenantId_key" ON "Opportunity"("meetingId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybookProposal_id_tenantId_key" ON "PlaybookProposal"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_id_tenantId_key" ON "Sequence"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceEnrollment_id_tenantId_key" ON "SequenceEnrollment"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_id_tenantId_key" ON "Template"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantAiBudgetPeriod_id_tenantId_key" ON "TenantAiBudgetPeriod"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_tenantId_key" ON "User"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_id_tenantId_key" ON "WorkOrder"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_tenantId_fkey" FOREIGN KEY ("managerId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("managerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "Client"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSdr" ADD CONSTRAINT "CampaignSdr_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSdr" ADD CONSTRAINT "CampaignSdr_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIntelligence" ADD CONSTRAINT "ContactIntelligence_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactIntelligence" ADD CONSTRAINT "ContactIntelligence_relationshipOwnerId_tenantId_fkey" FOREIGN KEY ("relationshipOwnerId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("relationshipOwnerId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE SET NULL ("campaignId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_meetingId_tenantId_fkey" FOREIGN KEY ("meetingId", "tenantId") REFERENCES "Meeting"("id", "tenantId") ON DELETE SET NULL ("meetingId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_opportunityId_tenantId_fkey" FOREIGN KEY ("opportunityId", "tenantId") REFERENCES "Opportunity"("id", "tenantId") ON DELETE SET NULL ("opportunityId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_activityId_tenantId_fkey" FOREIGN KEY ("activityId", "tenantId") REFERENCES "Activity"("id", "tenantId") ON DELETE SET NULL ("activityId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_capturedById_tenantId_fkey" FOREIGN KEY ("capturedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("capturedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvidence" ADD CONSTRAINT "ContactEvidence_supersedesId_tenantId_fkey" FOREIGN KEY ("supersedesId", "tenantId") REFERENCES "ContactEvidence"("id", "tenantId") ON DELETE SET NULL ("supersedesId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE SET NULL ("contactId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE SET NULL ("accountId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_tenantId_fkey" FOREIGN KEY ("assignedToId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sequenceId_tenantId_fkey" FOREIGN KEY ("sequenceId", "tenantId") REFERENCES "Sequence"("id", "tenantId") ON DELETE SET NULL ("sequenceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_tenantId_fkey" FOREIGN KEY ("sequenceId", "tenantId") REFERENCES "Sequence"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "Template"("id", "tenantId") ON DELETE SET NULL ("templateId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbTestVariant" ADD CONSTRAINT "AbTestVariant_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "Template"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_sequenceId_tenantId_fkey" FOREIGN KEY ("sequenceId", "tenantId") REFERENCES "Sequence"("id", "tenantId") ON DELETE SET NULL ("sequenceId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("userId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "Template"("id", "tenantId") ON DELETE SET NULL ("templateId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_abVariantId_tenantId_fkey" FOREIGN KEY ("abVariantId", "tenantId") REFERENCES "AbTestVariant"("id", "tenantId") ON DELETE SET NULL ("abVariantId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE SET NULL ("campaignId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_tenantId_fkey" FOREIGN KEY ("sequenceId", "tenantId") REFERENCES "Sequence"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStepCopy" ADD CONSTRAINT "SequenceStepCopy_enrollmentId_tenantId_fkey" FOREIGN KEY ("enrollmentId", "tenantId") REFERENCES "SequenceEnrollment"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStepCopy" ADD CONSTRAINT "SequenceStepCopy_approvedById_tenantId_fkey" FOREIGN KEY ("approvedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("approvedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceDraftRecord" ADD CONSTRAINT "SequenceDraftRecord_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceDraftRecord" ADD CONSTRAINT "SequenceDraftRecord_draftedById_tenantId_fkey" FOREIGN KEY ("draftedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("draftedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE SET NULL ("campaignId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_tenantId_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_poolItemId_tenantId_fkey" FOREIGN KEY ("poolItemId", "tenantId") REFERENCES "LeadPoolItem"("id", "tenantId") ON DELETE SET NULL ("poolItemId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMemory" ADD CONSTRAINT "AiMemory_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "Client"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("createdById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "Client"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_sdrId_tenantId_fkey" FOREIGN KEY ("sdrId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_bookingLinkId_tenantId_fkey" FOREIGN KEY ("bookingLinkId", "tenantId") REFERENCES "BookingLink"("id", "tenantId") ON DELETE SET NULL ("bookingLinkId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_outcomeLoggedById_tenantId_fkey" FOREIGN KEY ("outcomeLoggedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("outcomeLoggedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "Client"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE SET NULL ("accountId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE SET NULL ("contactId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_meetingId_tenantId_fkey" FOREIGN KEY ("meetingId", "tenantId") REFERENCES "Meeting"("id", "tenantId") ON DELETE SET NULL ("meetingId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_tenantId_fkey" FOREIGN KEY ("ownerId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_opportunityId_tenantId_fkey" FOREIGN KEY ("opportunityId", "tenantId") REFERENCES "Opportunity"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityActivity" ADD CONSTRAINT "OpportunityActivity_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_clientId_tenantId_fkey" FOREIGN KEY ("clientId", "tenantId") REFERENCES "Client"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE SET NULL ("campaignId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_generatedById_tenantId_fkey" FOREIGN KEY ("generatedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReport" ADD CONSTRAINT "ClientReport_approvedById_tenantId_fkey" FOREIGN KEY ("approvedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("approvedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReportRecipient" ADD CONSTRAINT "ClientReportRecipient_reportId_tenantId_fkey" FOREIGN KEY ("reportId", "tenantId") REFERENCES "ClientReport"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReportExport" ADD CONSTRAINT "ClientReportExport_reportId_tenantId_fkey" FOREIGN KEY ("reportId", "tenantId") REFERENCES "ClientReport"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReportExport" ADD CONSTRAINT "ClientReportExport_exportedById_tenantId_fkey" FOREIGN KEY ("exportedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReportShareLink" ADD CONSTRAINT "ClientReportShareLink_reportId_tenantId_fkey" FOREIGN KEY ("reportId", "tenantId") REFERENCES "ClientReport"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientReportShareLink" ADD CONSTRAINT "ClientReportShareLink_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE SET NULL ("accountId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE SET NULL ("contactId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_importBatchId_tenantId_fkey" FOREIGN KEY ("importBatchId", "tenantId") REFERENCES "ImportBatch"("id", "tenantId") ON DELETE SET NULL ("importBatchId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_duplicateOfId_tenantId_fkey" FOREIGN KEY ("duplicateOfId", "tenantId") REFERENCES "LeadPoolItem"("id", "tenantId") ON DELETE SET NULL ("duplicateOfId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_qualifiedById_tenantId_fkey" FOREIGN KEY ("qualifiedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("qualifiedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_assignedCampaignId_tenantId_fkey" FOREIGN KEY ("assignedCampaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE SET NULL ("assignedCampaignId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_assignedSdrId_tenantId_fkey" FOREIGN KEY ("assignedSdrId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("assignedSdrId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_convertedLeadId_tenantId_fkey" FOREIGN KEY ("convertedLeadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("convertedLeadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadPoolItem" ADD CONSTRAINT "LeadPoolItem_assignedById_tenantId_fkey" FOREIGN KEY ("assignedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("assignedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLeadRequirement" ADD CONSTRAINT "CampaignLeadRequirement_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLeadRequirement" ADD CONSTRAINT "CampaignLeadRequirement_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadgenActivity" ADD CONSTRAINT "LeadgenActivity_poolItemId_tenantId_fkey" FOREIGN KEY ("poolItemId", "tenantId") REFERENCES "LeadPoolItem"("id", "tenantId") ON DELETE SET NULL ("poolItemId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadgenActivity" ADD CONSTRAINT "LeadgenActivity_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAiBudgetReservation" ADD CONSTRAINT "TenantAiBudgetReservation_periodId_tenantId_fkey" FOREIGN KEY ("periodId", "tenantId") REFERENCES "TenantAiBudgetPeriod"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPlaybook" ADD CONSTRAINT "CampaignPlaybook_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPlaybook" ADD CONSTRAINT "CampaignPlaybook_currentVersionId_tenantId_fkey" FOREIGN KEY ("currentVersionId", "tenantId") REFERENCES "CampaignPlaybookVersion"("id", "tenantId") ON DELETE SET NULL ("currentVersionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPlaybookVersion" ADD CONSTRAINT "CampaignPlaybookVersion_playbookId_tenantId_fkey" FOREIGN KEY ("playbookId", "tenantId") REFERENCES "CampaignPlaybook"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPlaybookVersion" ADD CONSTRAINT "CampaignPlaybookVersion_fromProposalId_tenantId_fkey" FOREIGN KEY ("fromProposalId", "tenantId") REFERENCES "PlaybookProposal"("id", "tenantId") ON DELETE SET NULL ("fromProposalId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectTransition" ADD CONSTRAINT "ProspectTransition_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectTransition" ADD CONSTRAINT "ProspectTransition_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_playbookVersionId_tenantId_fkey" FOREIGN KEY ("playbookVersionId", "tenantId") REFERENCES "CampaignPlaybookVersion"("id", "tenantId") ON DELETE SET NULL ("playbookVersionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_agentActionId_tenantId_fkey" FOREIGN KEY ("agentActionId", "tenantId") REFERENCES "AgentAction"("id", "tenantId") ON DELETE SET NULL ("agentActionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_playbookVersionId_tenantId_fkey" FOREIGN KEY ("playbookVersionId", "tenantId") REFERENCES "CampaignPlaybookVersion"("id", "tenantId") ON DELETE SET NULL ("playbookVersionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdById_tenantId_fkey" FOREIGN KEY ("createdById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLease" ADD CONSTRAINT "WorkOrderLease_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLease" ADD CONSTRAINT "WorkOrderLease_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_agentActionId_tenantId_fkey" FOREIGN KEY ("agentActionId", "tenantId") REFERENCES "AgentAction"("id", "tenantId") ON DELETE SET NULL ("agentActionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_playbookVersionId_tenantId_fkey" FOREIGN KEY ("playbookVersionId", "tenantId") REFERENCES "CampaignPlaybookVersion"("id", "tenantId") ON DELETE SET NULL ("playbookVersionId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_requestedById_tenantId_fkey" FOREIGN KEY ("requestedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentApprovalRequest" ADD CONSTRAINT "AgentApprovalRequest_approvedById_tenantId_fkey" FOREIGN KEY ("approvedById", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("approvedById") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_templateId_tenantId_fkey" FOREIGN KEY ("templateId", "tenantId") REFERENCES "Template"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE SET NULL ("leadId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailHealthSnapshot" ADD CONSTRAINT "EmailHealthSnapshot_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailHealthSnapshot" ADD CONSTRAINT "EmailHealthSnapshot_userId_tenantId_fkey" FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailHealthAlert" ADD CONSTRAINT "EmailHealthAlert_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "EmailAccount"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailHealthAlert" ADD CONSTRAINT "EmailHealthAlert_campaignId_tenantId_fkey" FOREIGN KEY ("campaignId", "tenantId") REFERENCES "Campaign"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountResearchCache" ADD CONSTRAINT "AccountResearchCache_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactResearchCache" ADD CONSTRAINT "ContactResearchCache_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_cacheId_tenantId_fkey" FOREIGN KEY ("cacheId", "tenantId") REFERENCES "AccountResearchCache"("id", "tenantId") ON DELETE SET NULL ("cacheId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_aiCallId_tenantId_fkey" FOREIGN KEY ("aiCallId", "tenantId") REFERENCES "AiCall"("id", "tenantId") ON DELETE SET NULL ("aiCallId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_cacheId_tenantId_fkey" FOREIGN KEY ("cacheId", "tenantId") REFERENCES "AccountResearchCache"("id", "tenantId") ON DELETE SET NULL ("cacheId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPainHypothesis" ADD CONSTRAINT "AccountPainHypothesis_aiCallId_tenantId_fkey" FOREIGN KEY ("aiCallId", "tenantId") REFERENCES "AiCall"("id", "tenantId") ON DELETE SET NULL ("aiCallId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_contactId_tenantId_fkey" FOREIGN KEY ("contactId", "tenantId") REFERENCES "Contact"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_accountId_tenantId_fkey" FOREIGN KEY ("accountId", "tenantId") REFERENCES "Account"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_cacheId_tenantId_fkey" FOREIGN KEY ("cacheId", "tenantId") REFERENCES "ContactResearchCache"("id", "tenantId") ON DELETE SET NULL ("cacheId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE SET NULL ("workOrderId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizationHook" ADD CONSTRAINT "PersonalizationHook_aiCallId_tenantId_fkey" FOREIGN KEY ("aiCallId", "tenantId") REFERENCES "AiCall"("id", "tenantId") ON DELETE SET NULL ("aiCallId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_leadId_tenantId_fkey" FOREIGN KEY ("leadId", "tenantId") REFERENCES "Lead"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_sequenceId_tenantId_fkey" FOREIGN KEY ("sequenceId", "tenantId") REFERENCES "Sequence"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceLaunch" ADD CONSTRAINT "SequenceLaunch_workOrderId_tenantId_fkey" FOREIGN KEY ("workOrderId", "tenantId") REFERENCES "WorkOrder"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposal" ADD CONSTRAINT "PlaybookProposal_playbookId_tenantId_fkey" FOREIGN KEY ("playbookId", "tenantId") REFERENCES "CampaignPlaybook"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybookProposal" ADD CONSTRAINT "PlaybookProposal_basedOnVersionId_tenantId_fkey" FOREIGN KEY ("basedOnVersionId", "tenantId") REFERENCES "CampaignPlaybookVersion"("id", "tenantId") ON DELETE SET NULL ("basedOnVersionId") ON UPDATE CASCADE;

