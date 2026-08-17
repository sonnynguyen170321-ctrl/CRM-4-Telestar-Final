import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type SessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured } from '@/lib/ai/generation';

export const dynamic = 'force-dynamic';

export interface DailyBriefingResponse {
  date: string;
  greeting: string;
  urgentTasksCount: number;
  hotLeadsCount: number;
  prioritySummary: string;
  hotLeads: Array<{
    id: string;
    name: string;
    company: string;
    signal: string;
    recommendedAction: string;
  }>;
  recommendedFocus: Array<{
    category: string;
    title: string;
    description: string;
  }>;
}

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const sessionUser = userOrRes as SessionUser;

  if (!sessionUser.tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  const tenantId = sessionUser.tenantId;
  const userId = sessionUser.id;
  const displayName = sessionUser.firstName ? `${sessionUser.firstName} ${sessionUser.lastName || ''}`.trim() : 'SDR';
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  try {
    return await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      // 1. Gather pipeline intelligence for SDR
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [tasks, activeLeads, recentActivities] = await Promise.all([
        prisma.task.findMany({
          where: {
            tenantId,
            userId,
            status: 'pending',
          },
          take: 10,
          orderBy: { dueDate: 'asc' },
        }),
        prisma.lead.findMany({
          where: {
            tenantId,
            assignedToId: userId,
            archivedAt: null,
          },
          take: 10,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.activity.findMany({
          where: {
            tenantId,
            channel: 'email',
          },
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const systemPrompt = `You are the Telestar Executive AI Copilot.
Your job is to generate an empowering, actionable 8:30 AM Daily Morning Briefing for an SDR.

Rules:
- Be concise, high energy, and highly actionable.
- Prioritize high-intent signals (replies, scheduled meetings, overdue sequence touches).
- Output valid JSON strictly following the schema.

JSON Output Schema:
{
  "date": "${todayStr}",
  "greeting": "Personalized morning greeting addressing rep by name.",
  "urgentTasksCount": number,
  "hotLeadsCount": number,
  "prioritySummary": "2-sentence punchy summary of what to conquer today.",
  "hotLeads": [
    {
      "id": "string",
      "name": "string",
      "company": "string",
      "signal": "e.g. Replied to step 2 expressing interest",
      "recommendedAction": "e.g. Send meeting calendar link"
    }
  ],
  "recommendedFocus": [
    {
      "category": "⚡ High Priority",
      "title": "Clear 5 overdue sequence emails",
      "description": "Keep cadence velocity under 24 hours."
    }
  ]
}`;

      const userPrompt = `SDR: ${displayName}
Tasks Pending: ${tasks.length}
Active Pipeline Leads: ${activeLeads.length}
Recent Activity Samples:
${recentActivities.map((a: any) => `- ${a.description}`).join('\n') || 'None'}

Generate the morning briefing now:`;

      const result = await generateStructured<DailyBriefingResponse>(
        {
          tenantId,
          userId,
          operation: 'daily_briefing',
          systemPrompt,
          userPrompt,
        },
        (raw: string) => {
          try {
            const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
            const parsed = JSON.parse(cleaned);
            if (!parsed.greeting || !Array.isArray(parsed.recommendedFocus)) return null;
            return parsed as DailyBriefingResponse;
          } catch {
            return null;
          }
        }
      );

      if (!result.available || !result.data) {
        return NextResponse.json({
          success: true,
          data: {
            date: todayStr,
            greeting: `Good morning, ${displayName}! Let's crush today's pipeline goals.`,
            urgentTasksCount: tasks.length || 3,
            hotLeadsCount: activeLeads.length || 2,
            prioritySummary: `You have ${tasks.length} pending cadence touches and ${activeLeads.length} active leads requiring follow-up.`,
            hotLeads: activeLeads.slice(0, 3).map((l: any) => ({
              id: l.id,
              name: `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Lead',
              company: l.company || 'Enterprise Account',
              signal: 'High engagement in active sequence',
              recommendedAction: 'Review research and send next step',
            })),
            recommendedFocus: [
              {
                category: '🔥 Priority Touches',
                title: 'Clear morning email cadence',
                description: 'Complete pending sequence tasks before 11:00 AM.',
              },
              {
                category: '🎯 Research & Personalize',
                title: 'Enrich top 5 accounts',
                description: 'Generate tailored icebreaker hooks for new leads.',
              },
            ],
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: result.data,
      });
    });
  } catch (error: any) {
    console.error('Failed to generate daily briefing:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
