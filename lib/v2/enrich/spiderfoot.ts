import * as cheerio from "cheerio";

export type TechStackFingerprint = {
  technologies: string[];
};

/**
 * Quét mã nguồn HTML của website để nhận diện các công nghệ (Tech Stack) phổ biến được sử dụng.
 */
export function detectTechnologies(html: string): TechStackFingerprint {
  const technologies: string[] = [];
  if (!html) {
    return { technologies };
  }

  try {
    const $ = cheerio.load(html);

    // 1. Quét các thẻ Script nguồn
    const scripts = $("script")
      .map((_, el) => $(el).attr("src") || "")
      .get()
      .join(" ");

    if (scripts.includes("js.hs-scripts.com") || scripts.includes("js.hsleadflows.net")) {
      technologies.push("HubSpot");
    }
    if (scripts.includes("salesforce.com") || scripts.includes("sf-conversations")) {
      technologies.push("Salesforce");
    }
    if (scripts.includes("gtm.js") || scripts.includes("analytics.js")) {
      technologies.push("Google Analytics");
    }
    if (scripts.includes("fbds.js") || scripts.includes("connect.facebook.net")) {
      technologies.push("Facebook Pixel");
    }
    if (scripts.includes("stripe.com")) {
      technologies.push("Stripe");
    }

    // 2. Quét thẻ Generator Meta
    const generator = $("meta[name='generator']").attr("content") || "";
    if (generator.toLowerCase().includes("shopify")) {
      technologies.push("Shopify");
    }
    if (generator.toLowerCase().includes("wordpress")) {
      technologies.push("WordPress");
    }
    if (generator.toLowerCase().includes("webflow")) {
      technologies.push("Webflow");
    }

    // 3. Quét class hoặc logo cụ thể
    const hasReact = html.includes("data-reactroot") || html.includes("react-");
    if (hasReact) {
      technologies.push("React");
    }
  } catch {}

  return { technologies };
}
// 
