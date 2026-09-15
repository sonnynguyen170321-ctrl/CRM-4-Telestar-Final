'use client';

import { useQuery } from '@tanstack/react-query';
import { isValidTimezone } from '@/lib/automation/timezone';

/**
 * The signed-in user's timezone, from the profile the Settings page already reads.
 *
 * Not put in the JWT on purpose: a session field goes stale until re-login, and a rep who
 * changes their zone in Settings should see the change on the next screen, not next week.
 * Cached for a while — it changes about never — and invalidated by the Settings save.
 */
export const USER_TIMEZONE_QUERY_KEY = ['settings', 'profile', 'timezone'] as const;
const FALLBACK = 'Asia/Ho_Chi_Minh';

export function useUserTimezone(): { timezone: string; isLoading: boolean } {
  const { data, isLoading } = useQuery<string>({
    queryKey: USER_TIMEZONE_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) return FALLBACK;
      const profile = (await res.json()) as { timezone?: string | null };
      return profile.timezone && isValidTimezone(profile.timezone) ? profile.timezone : FALLBACK;
    },
    staleTime: 30 * 60 * 1000,
  });
  return { timezone: data ?? FALLBACK, isLoading };
}
