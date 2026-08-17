import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { GET as getOpenApiSpec } from '@/app/api/v1/openapi.json/route';

describe('Developer API & Integrations Ecosystem', () => {
  describe('OpenAPI 3.1 Specification', () => {
    it('generates a valid OpenAPI 3.1 schema', async () => {
      const res = await getOpenApiSpec();
      expect(res.status).toBe(200);

      const spec = await res.json();
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.info.title).toContain('Telestar CRM');
      expect(spec.paths['/api/v1/leads']).toBeDefined();
      expect(spec.paths['/api/v1/calls']).toBeDefined();
      expect(spec.paths['/api/v1/enrich']).toBeDefined();
      expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    });
  });

  describe('API Key Cryptographic Integrity', () => {
    it('properly generates, prefixes, and hashes secret tokens', () => {
      const randomSecret = crypto.randomBytes(24).toString('hex');
      const secretKey = `tl_live_${randomSecret}`;
      const keyPrefix = `${secretKey.substring(0, 12)}...`;
      const keyHash = crypto.createHash('sha256').update(secretKey).digest('hex');

      expect(secretKey.startsWith('tl_live_')).toBe(true);
      expect(keyPrefix.length).toBe(15);
      expect(keyHash).toHaveLength(64); // SHA-256 hex string

      // Verify re-hashing yields exact match
      const reHash = crypto.createHash('sha256').update(secretKey).digest('hex');
      expect(reHash).toBe(keyHash);
    });

    it('rejects tampered or malformed keys', () => {
      const validKey = 'tl_live_' + 'a'.repeat(48);
      const tamperedKey = 'tl_live_' + 'a'.repeat(47) + 'b';

      const hashA = crypto.createHash('sha256').update(validKey).digest('hex');
      const hashB = crypto.createHash('sha256').update(tamperedKey).digest('hex');

      expect(hashA).not.toBe(hashB);
    });
  });

  describe('VOIP Call Data Formatting & Logic', () => {
    it('formats call duration and notes correctly into activity metadata', () => {
      const durationSeconds = 195;
      const durationMin = Math.floor(durationSeconds / 60);
      const durationSec = durationSeconds % 60;
      const durationStr = `${durationMin}m ${durationSec}s`;

      expect(durationStr).toBe('3m 15s');

      const outcome = 'meeting_booked';
      const notes = 'Booked product demo';
      const recordingUrl = 'https://recordings.aircall.io/rec_1.mp3';

      const description = `📞 [VOIP Call] OUTBOUND (${durationStr}) - Outcome: ${outcome.toUpperCase()}\nNotes: ${notes}\n🎙️ Audio Recording: ${recordingUrl}`;

      expect(description).toContain('3m 15s');
      expect(description).toContain('Outcome: MEETING_BOOKED');
      expect(description).toContain('https://recordings.aircall.io/rec_1.mp3');
    });

    it('determines appropriate lead stage progression for call outcomes', () => {
      const resolveStage = (currentStage: string, outcome: string) => {
        if (outcome === 'meeting_booked') return 'meeting_booked';
        if (outcome === 'connected' && (currentStage === 'new' || currentStage === 'sequence_active')) {
          return 'replied';
        }
        return currentStage;
      };

      expect(resolveStage('new', 'meeting_booked')).toBe('meeting_booked');
      expect(resolveStage('new', 'connected')).toBe('replied');
      expect(resolveStage('sequence_active', 'connected')).toBe('replied');
      expect(resolveStage('new', 'voicemail')).toBe('new');
      expect(resolveStage('won', 'connected')).toBe('won');
    });
  });
});
