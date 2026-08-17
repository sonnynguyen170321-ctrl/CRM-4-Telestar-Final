import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/openapi.json
 * Generates the OpenAPI 3.1.0 JSON specification for Telestar CRM.
 */
export async function GET() {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Telestar CRM Developer & Integrations API',
      version: '1.0.0',
      description:
        'Public REST API for integrating external VOIP callers (Aircall, Twilio, JustCall), lead intelligence tools (Clay, Apollo, ZoomInfo), and automation workflows (Zapier, n8n).',
      contact: {
        name: 'Telestar Engineering',
        email: 'sonny@itelestar.com',
        url: 'https://crm.telestar.cloud',
      },
    },
    servers: [
      {
        url: 'https://crm.telestar.cloud',
        description: 'Production Server',
      },
      {
        url: 'http://localhost:3000',
        description: 'Local Development Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key (tl_live_...)',
          description: 'Enter your API key generated in Settings > Developer (e.g. `tl_live_...`).',
        },
      },
      schemas: {
        LeadInput: {
          type: 'object',
          required: ['firstName', 'company'],
          properties: {
            firstName: { type: 'string', example: 'Alex' },
            lastName: { type: 'string', example: 'Morgan' },
            email: { type: 'string', format: 'email', example: 'alex@acme.corp' },
            phone: { type: 'string', example: '+1 (555) 234-5678' },
            company: { type: 'string', example: 'Acme Technologies' },
            title: { type: 'string', example: 'VP of Growth' },
            linkedinUrl: { type: 'string', format: 'uri', example: 'https://linkedin.com/in/alexmorgan' },
            campaignId: { type: 'string', description: 'Optional campaign ID (defaults to active campaign)' },
            notes: { type: 'string', example: 'Discovered via Clay ICP filter: Series B B2B SaaS' },
          },
        },
        CallLogInput: {
          type: 'object',
          properties: {
            leadId: { type: 'string', example: 'cly123456789' },
            phone: { type: 'string', example: '+1 (555) 234-5678' },
            email: { type: 'string', example: 'alex@acme.corp' },
            direction: { type: 'string', enum: ['outbound', 'inbound'], default: 'outbound' },
            durationSeconds: { type: 'integer', example: 145 },
            outcome: {
              type: 'string',
              enum: ['connected', 'voicemail', 'gatekeeper', 'busy', 'no_answer', 'meeting_booked'],
              example: 'meeting_booked',
            },
            recordingUrl: { type: 'string', format: 'uri', example: 'https://recordings.aircall.io/rec_123.mp3' },
            notes: { type: 'string', example: 'Prospect agreed to discovery call next Tuesday at 2 PM EST.' },
          },
        },
        EnrichmentInput: {
          type: 'object',
          properties: {
            leadId: { type: 'string', example: 'cly123456789' },
            email: { type: 'string', example: 'alex@acme.corp' },
            companyData: {
              type: 'object',
              properties: {
                industry: { type: 'string', example: 'Fintech / Payments' },
                employeeCount: { type: 'string', example: '150-250' },
                techStack: { type: 'array', items: { type: 'string' }, example: ['HubSpot', 'Snowflake', 'Stripe'] },
              },
            },
            personData: {
              type: 'object',
              properties: {
                title: { type: 'string', example: 'Chief Information Security Officer' },
                linkedinUrl: { type: 'string', example: 'https://linkedin.com/in/alexmorgan' },
              },
            },
            researchSummary: { type: 'string', example: 'Company recently raised $25M and is hiring SDRs.' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/leads': {
        get: {
          summary: 'Search & List Leads',
          description: 'Retrieve a list of leads filtered by name, email, company, or campaign.',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search term for name or company' },
            { name: 'email', in: 'query', schema: { type: 'string' }, description: 'Filter by exact email' },
            { name: 'phone', in: 'query', schema: { type: 'string' }, description: 'Filter by phone number' },
            { name: 'campaignId', in: 'query', schema: { type: 'string' }, description: 'Filter by campaign ID' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Max leads to return' },
          ],
          responses: {
            '200': {
              description: 'List of leads returned successfully',
            },
            '401': { description: 'Unauthorized' },
          },
        },
        post: {
          summary: 'Ingest / Create Lead',
          description: 'Push a newly researched lead into the CRM. Automatically deduplicates by email.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LeadInput' },
              },
            },
          },
          responses: {
            '201': { description: 'Lead created successfully' },
            '200': { description: 'Existing lead updated' },
            '400': { description: 'Validation error' },
          },
        },
      },
      '/api/v1/calls': {
        post: {
          summary: 'Log VOIP Call Activity',
          description: 'Log a call from external dialers (Aircall, Twilio, JustCall). Automatically updates lead stage.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CallLogInput' },
              },
            },
          },
          responses: {
            '201': { description: 'Call logged successfully and lead stage updated' },
            '404': { description: 'Lead not found' },
          },
        },
      },
      '/api/v1/enrich': {
        post: {
          summary: 'Enrich Lead Intelligence',
          description: 'Push external firmographic and demographic intelligence from Clay, Apollo, or ZoomInfo.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EnrichmentInput' },
              },
            },
          },
          responses: {
            '200': { description: 'Lead enriched successfully' },
            '404': { description: 'Lead not found' },
          },
        },
      },
    },
  };

  return NextResponse.json(spec);
}
