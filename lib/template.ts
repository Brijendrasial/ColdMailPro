/**
 * Very small templating:
 * - {{firstName}} {{lastName}} {{email}} {{company}} {{website}}
 * - {{senderName}} {{senderEmail}}
 */
export function renderTemplate(tpl: string, vars: Record<string, string | undefined | null>) {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? "" : String(v);
  });
}

export function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
