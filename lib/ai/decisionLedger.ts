/**
 * Telestar Decision Ledger (Directive Phase 23 §84, Phase 24 §85).
 * Empirical tracking of AI recommendations vs human actions vs actual commercial outcomes.
 */

export interface DecisionRecord {
  id: string;
  tenantId: string;
  recommendationType: string;
  recommendationSummary: string;
  evidenceBasis: string;
  confidenceScore: number;
  humanDecision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED' | 'IGNORED';
  humanActorId: string;
  decisionTimestamp: Date;
  expectedOutcome: string;
  actualOutcome?: string | null;
  outcomeRecordedAt?: Date | null;
  commercialValueGeneratedUsd?: number | null;
}

export class DecisionLedgerStore {
  private records = new Map<string, DecisionRecord>();

  public logDecision(record: Omit<DecisionRecord, 'id' | 'decisionTimestamp'>): DecisionRecord {
    const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const full: DecisionRecord = {
      ...record,
      id,
      decisionTimestamp: new Date(),
    };
    this.records.set(id, full);
    return full;
  }

  public recordOutcome(decisionId: string, actualOutcome: string, valueUsd?: number): DecisionRecord | null {
    const record = this.records.get(decisionId);
    if (!record) return null;

    record.actualOutcome = actualOutcome;
    record.outcomeRecordedAt = new Date();
    if (valueUsd !== undefined) record.commercialValueGeneratedUsd = valueUsd;
    this.records.set(decisionId, record);
    return record;
  }

  public getRecordsForTenant(tenantId: string): DecisionRecord[] {
    return Array.from(this.records.values()).filter((r) => r.tenantId === tenantId);
  }
}

export const decisionLedger = new DecisionLedgerStore();
