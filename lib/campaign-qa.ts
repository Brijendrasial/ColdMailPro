import { prisma } from "@/lib/prisma";

// Very lightweight "Instantly-style" pre-send checks.
// Goal: catch obvious mistakes (empty subject/body, unresolved variables, spammy phrasing)
// before letting the campaign start.

const ALLOWED_VARS = new Set([
  "firstName",
  "lastName",
  "email",
  "company",
  "website",
  "senderName",
  "senderEmail",
]);

const SPAM_PHRASES = [
  "free money",
  "make money fast",
  "guaranteed",
  "risk free",
  "act now",
  "limited time",
  "winner",
  "congratulations",
  "urgent",
  "click here",
  "buy now",
  "100%",
  "no credit check",
  "cash bonus",
];

function extractVars(tpl: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(tpl || "")))) {
    out.push(m[1]);
  }
  return out;
}

function countLinks(s: string): number {
  const t = String(s || "");
  const m = t.match(/https?:\/\//gi);
  return m ? m.length : 0;
}

function capsRatio(s: string): number {
  const t = String(s || "");
  let upper = 0;
  let alpha = 0;
  for (const ch of t) {
    if (/[a-z]/i.test(ch)) {
      alpha++;
      if (/[A-Z]/.test(ch)) upper++;
    }
  }
  return alpha ? upper / alpha : 0;
}

export type QaIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  stepNumber?: number;
  variantName?: string | null;
};

export type QaReport = {
  ok: boolean;
  spamScore: number; // 0..100 (heuristic)
  errors: QaIssue[];
  warnings: QaIssue[];
};

export async function buildCampaignQaReport(workspaceId: string, campaignId: string): Promise<QaReport> {
  const camp: any = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
    include: { steps: { include: { variants: true }, orderBy: { stepNumber: "asc" } } },
  });
  if (!camp) {
    return {
      ok: false,
      spamScore: 0,
      errors: [{ level: "error", code: "NOT_FOUND", message: "Campaign not found" }],
      warnings: [],
    };
  }

  const issues: QaIssue[] = [];
  let spam = 0;

  const push = (i: QaIssue) => issues.push(i);

  for (const step of camp.steps || []) {
    const variants = Array.isArray(step.variants) && step.variants.length ? step.variants : [null];

    for (const v of variants) {
      const subj = String(v?.subjectTpl ?? step.subjectTpl ?? "").trim();
      const body = String(v?.bodyTpl ?? step.bodyTpl ?? "").trim();
      const stepNumber = Number(step.stepNumber);
      const variantName = v?.name ?? null;

      if (!subj) {
        push({ level: "error", code: "EMPTY_SUBJECT", message: "Subject is empty", stepNumber, variantName });
      }
      if (!body) {
        push({ level: "error", code: "EMPTY_BODY", message: "Body is empty", stepNumber, variantName });
      }

      // Unknown variables
      for (const key of [...extractVars(subj), ...extractVars(body)]) {
        if (!ALLOWED_VARS.has(key)) {
          push({ level: "warning", code: "UNKNOWN_VAR", message: `Unknown variable: {{${key}}}`, stepNumber, variantName });
          spam += 2;
        }
      }

      // Spam phrases
      const lower = (subj + "\n" + body).toLowerCase();
      for (const p of SPAM_PHRASES) {
        if (lower.includes(p)) {
          push({ level: "warning", code: "SPAM_PHRASE", message: `Potentially spammy phrase: “${p}”`, stepNumber, variantName });
          spam += 8;
        }
      }

      // Too many links
      const links = countLinks(body);
      if (links >= 4) {
        push({ level: "warning", code: "TOO_MANY_LINKS", message: `Too many links in body (${links})`, stepNumber, variantName });
        spam += Math.min(20, (links - 3) * 6);
      }

      // Excessive caps in subject
      const cr = capsRatio(subj);
      if (subj.length >= 20 && cr > 0.4) {
        push({ level: "warning", code: "EXCESS_CAPS", message: "Subject has excessive capital letters", stepNumber, variantName });
        spam += 10;
      }

      // No plain unsubscribe mention (headers are added automatically, so warn only)
      if (!lower.includes("unsubscribe")) {
        push({ level: "warning", code: "NO_UNSUB_TEXT", message: "Consider adding an unsubscribe line (we also add List-Unsubscribe headers)", stepNumber, variantName });
      }
    }
  }

  // Clamp score
  spam = Math.max(0, Math.min(100, spam));

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  return {
    ok: errors.length === 0,
    spamScore: spam,
    errors,
    warnings,
  };
}
