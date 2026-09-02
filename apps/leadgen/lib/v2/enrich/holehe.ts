import { safeFetch } from "@/lib/v2/company-intelligence/safeFetch";

export type HoleheResult = {
  platform: string;
  registered: boolean;
  confidence: "HIGH" | "LOW";
};

/**
 * Thăm dò nhanh (không cần đăng nhập) xem email có đăng ký tài khoản ở các dịch vụ lớn hay không.
 */
export async function checkEmailRegistration(email: string): Promise<HoleheResult[]> {
  const results: HoleheResult[] = [];
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return results;
  }

  // 1. Thăm dò Github API (Tìm kiếm user qua email)
  try {
    const res = await safeFetch(`https://api.github.com/users/${cleanEmail.split("@")[0]}`, {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; TelestarResearchBot/1.0)",
      },
    });
    if (res.ok && res.status === 200) {
      results.push({ platform: "github", registered: true, confidence: "HIGH" });
    }
  } catch {}

  // 2. Thăm dò LinkedIn check-email-availability
  try {
    const res = await safeFetch(`https://www.linkedin.com/admin/check-email-availability?email=${encodeURIComponent(cleanEmail)}`, {
      method: "GET",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; TelestarResearchBot/1.0)",
      },
    });
    if (res.ok) {
      const json = (await res.response.json()) as { exists?: boolean };
      if (json.exists === true) {
        results.push({ platform: "linkedin", registered: true, confidence: "HIGH" });
      }
    }
  } catch {}

  return results;
}
