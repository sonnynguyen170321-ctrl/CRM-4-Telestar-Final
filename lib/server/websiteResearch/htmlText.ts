export function extractTitle(html: string) {
  return extractTagContent(html, "title");
}

export function extractMetaDescription(html: string) {
  const match = html.match(
    /<meta\s+[^>]*(?:name|property)=["'](?:description|og:description)["'][^>]*>/i
  );

  if (!match) {
    return null;
  }

  const content = match[0].match(/\scontent=["']([^"']+)["']/i);
  return content ? decodeHtml(content[1]).trim() : null;
}

export function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
  ).trim();
}

export function createTextSnippet(text: string, maxLength = 320) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trim()}...`;
}

function extractTagContent(html: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(pattern);
  return match ? decodeHtml(match[1]).trim() : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
