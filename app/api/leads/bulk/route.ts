import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { PingEmail } from "ping-email";
import { emailDomain, hasMxRecord, isDisposable, isFreeProvider, isRoleBased, riskScore } from "@/lib/email-quality";
import { logLeadActivity } from "@/lib/lead-activity";

type Action =
  | "tag_add"
  | "tag_remove"
  | "set_status"
  | "set_stage"
  | "assign_owner"
  | "move_list"
  | "create_task"
  | "verify_email"
  | "dnc"
  | "unsuppress"
  | "enroll_campaign"
  | "stop_campaigns"
  | "delete";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function parseTags(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => norm(String(x))).filter(Boolean);
  return String(v)
    .split(",")
    .map((t) => norm(t))
    .filter(Boolean);
}

function mergeTags(existing: string | null | undefined, add: string[], remove: string[] = []) {
  const set = new Set<string>();
  for (const t of String(existing || "")
    .split(",")
    .map((x) => norm(x))
    .filter(Boolean)) {
    set.add(t);
  }
  for (const t of add) set.add(t);
  for (const t of remove) set.delete(t);
  return Array.from(set).join(",");
}

export async function POST(req: NextRequest) {
  const s = await requireSession();
  const body = await req.json().catch(() => ({} as any));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const action: Action = String(body.action || "") as Action;

  if (!ids.length) return NextResponse.json({ ok: false, error: "Missing ids" }, { status: 400 });

  const leads = await prisma.lead.findMany({ where: { id: { in: ids }, workspaceId: s.wid }, select: { id: true, email: true, tags: true } });
  const foundIds = leads.map((l) => l.id);
  if (!foundIds.length) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  if (action === "tag_add") {
    const tags = parseTags(body.tags);
    if (!tags.length) return NextResponse.json({ ok: false, error: "Missing tags" }, { status: 400 });
    await Promise.all(
      leads.map((l) =>
        prisma.lead.update({
          where: { id: l.id },
          data: { tags: mergeTags(l.tags, tags) },
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "tag_remove") {
    const tags = parseTags(body.tags);
    if (!tags.length) return NextResponse.json({ ok: false, error: "Missing tags" }, { status: 400 });
    await Promise.all(
      leads.map((l) =>
        prisma.lead.update({
          where: { id: l.id },
          data: { tags: mergeTags(l.tags, [], tags) },
        })
      )
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "set_status") {
    const status = norm(String(body.status || ""));
    if (!status) return NextResponse.json({ ok: false, error: "Missing status" }, { status: 400 });
    await prisma.lead.updateMany({ where: { id: { in: foundIds } }, data: { status } });
    await Promise.all(foundIds.map((leadId) => logLeadActivity({ workspaceId: s.wid, leadId, actorUserId: s.uid || null, type: "status", text: `Status set to ${status}` })));
    return NextResponse.json({ ok: true });
  }

  if (action === "set_stage") {
    const stage = norm(String(body.stage || ""));
    if (!stage) return NextResponse.json({ ok: false, error: "Missing stage" }, { status: 400 });
    await prisma.lead.updateMany({ where: { id: { in: foundIds }, workspaceId: s.wid }, data: { stage } as any });
    await Promise.all(foundIds.map((leadId) => logLeadActivity({ workspaceId: s.wid, leadId, actorUserId: s.uid || null, type: "stage", text: `Stage set to ${stage}` })));
    return NextResponse.json({ ok: true });
  }

  if (action === "assign_owner") {
    const ownerUserId = String(body.ownerUserId || "").trim();
    const val = ownerUserId ? ownerUserId : null;
    if (ownerUserId) {
      const mem = await prisma.membership.findFirst({ where: { workspaceId: s.wid, userId: ownerUserId }, select: { id: true } });
      if (!mem) return NextResponse.json({ ok: false, error: "Owner is not a member of this workspace" }, { status: 400 });
    }
    await prisma.lead.updateMany({ where: { id: { in: foundIds }, workspaceId: s.wid }, data: { ownerUserId: val } as any });
    await Promise.all(foundIds.map((leadId) => logLeadActivity({ workspaceId: s.wid, leadId, actorUserId: s.uid || null, type: "owner", text: val ? `Owner assigned` : `Owner cleared`, meta: { ownerUserId: val } })));
    return NextResponse.json({ ok: true });
  }

  if (action === "move_list") {
    const listId = String(body.listId || "").trim();
    const val = listId ? listId : null;
    if (listId) {
      const list = await prisma.leadList.findFirst({ where: { id: listId, workspaceId: s.wid }, select: { id: true, name: true } });
      if (!list) return NextResponse.json({ ok: false, error: "List not found" }, { status: 404 });
    }
    await prisma.lead.updateMany({ where: { id: { in: foundIds }, workspaceId: s.wid }, data: { listId: val } as any });
    await Promise.all(foundIds.map((leadId) => logLeadActivity({ workspaceId: s.wid, leadId, actorUserId: s.uid || null, type: "list", text: val ? `Moved to list` : `Removed from list`, meta: { listId: val } })));
    return NextResponse.json({ ok: true });
  }

  if (action === "create_task") {
    const title = String(body.title || "").trim();
    const dueAtRaw = body.dueAt ? String(body.dueAt).trim() : "";
    if (!title) return NextResponse.json({ ok: false, error: "Missing title" }, { status: 400 });

    let dueAt: Date | null = null;
    if (dueAtRaw) {
      const d = new Date(dueAtRaw);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ ok: false, error: "Invalid dueAt" }, { status: 400 });
      dueAt = d;
    }

    await prisma.leadTask.createMany({
      data: foundIds.map((leadId) => ({
        workspaceId: s.wid,
        leadId,
        createdByUserId: s.uid || null,
        title,
        dueAt: dueAt || undefined,
      })),
    });

    await Promise.all(
      foundIds.map((leadId) =>
        logLeadActivity({
          workspaceId: s.wid,
          leadId,
          actorUserId: s.uid || null,
          type: "task",
          text: `Task created: ${title}`,
          meta: { title, dueAt: dueAt ? dueAt.toISOString() : null },
        })
      )
    );

    return NextResponse.json({ ok: true });
  }

  if (action === "verify_email") {
    if (!env.PING_EMAIL_ENABLED) {
      return NextResponse.json({ ok: false, error: "Email verification is not enabled (PING_EMAIL_ENABLED=1)." }, { status: 400 });
    }
    const fqdn = env.PING_EMAIL_FQDN || undefined;
    const sender = env.PING_EMAIL_SENDER || undefined;
    if (!fqdn || !sender) {
      return NextResponse.json({ ok: false, error: "PING_EMAIL_FQDN and PING_EMAIL_SENDER are required." }, { status: 400 });
    }
    const verifyMode = String(body.verifyMode || "no_smtp");
    const requireMailbox = !!body.requireMailbox;
    const ignoreSMTPVerify = verifyMode === "no_smtp";
    if (requireMailbox && ignoreSMTPVerify) {
      return NextResponse.json({ ok: false, error: "Mailbox verification requires SMTP mode" }, { status: 400 });
    }

    const pingEmail = new PingEmail({
      port: env.PING_EMAIL_PORT,
      fqdn,
      sender,
      timeout: env.PING_EMAIL_TIMEOUT_MS,
      attempts: env.PING_EMAIL_ATTEMPTS,
      ignoreSMTPVerify,
      debug: env.PING_EMAIL_DEBUG,
    } as any);

    const results: Array<{ leadId: string; email: string; valid: boolean; message: string; risk: any }> = [];
    for (const l of leads) {
      const email = String(l.email || "").trim().toLowerCase();
      const suppressed = await prisma.suppression.findUnique({ where: { workspaceId_email: { workspaceId: s.wid, email } }, select: { reason: true } });
      const dom = emailDomain(email);
      const mxOk = dom ? await hasMxRecord(dom) : false;
      const baseFlags: any = {
        suppressed: !!suppressed,
        noMx: !mxOk,
        freeProvider: isFreeProvider(dom),
        roleBased: isRoleBased(email),
        disposable: isDisposable(dom),
      };
      if (suppressed) {
        const risk = { score: riskScore({ ...baseFlags, notVerified: false }, false), flags: baseFlags, domain: dom, mx: mxOk };
        results.push({ leadId: l.id, email, valid: false, message: `Suppressed (DNC) - ${suppressed.reason}`, risk });
        await logLeadActivity({ workspaceId: s.wid, leadId: l.id, actorUserId: s.uid || null, type: "verify", text: "Verification blocked (suppressed)", meta: { email, valid: false, reason: suppressed.reason, risk } });
        continue;
      }
      try {
        const res = await pingEmail.ping(email);
        const valid = !!res?.valid;
        const message = String(res?.message || "").trim() || (valid ? "OK" : "Invalid email");
        const mailboxConfirmed = message === "Valid email";
        const catchAll =
          !!(res as any)?.catchAll ||
          !!(res as any)?.isCatchAll ||
          /catch[ -]?all/i.test(String((res as any)?.message || "")) ||
          /catch[ -]?all/i.test(String((res as any)?.details || ""));
        const flags = { ...baseFlags, catchAll: !!catchAll, notVerified: !valid };
        const score = riskScore(flags as any, valid);
        const risk = { score, flags, domain: dom, mx: mxOk };

        const finalValid = requireMailbox ? !!(valid && mailboxConfirmed) : valid;
        const finalMsg = requireMailbox && !mailboxConfirmed ? `Not confirmed: ${message}` : message;
        results.push({ leadId: l.id, email, valid: finalValid, message: finalMsg, risk });
        await logLeadActivity({ workspaceId: s.wid, leadId: l.id, actorUserId: s.uid || null, type: "verify", text: `${finalValid ? "Valid" : "Invalid"}: ${finalMsg}`, meta: { email, valid: finalValid, risk } });
      } catch (e: any) {
        results.push({ leadId: l.id, email, valid: false, message: `Error: ${String(e?.message || e)}`, risk: null });
        await logLeadActivity({ workspaceId: s.wid, leadId: l.id, actorUserId: s.uid || null, type: "verify", text: "Verification error", meta: { email, error: String(e?.message || e) } });
      }
    }

    const summary = {
      total: results.length,
      valid: results.filter((r) => r.valid).length,
      invalid: results.filter((r) => !r.valid).length,
    };
    return NextResponse.json({ ok: true, summary, results });
  }

  if (action === "dnc") {
    // Create suppressions + mark lead status
    const reason = norm(String(body.reason || "manual")) || "manual";
    await Promise.all(
      leads.map((l) =>
        prisma.suppression.upsert({
          where: { workspaceId_email: { workspaceId: s.wid, email: l.email } },
          create: { workspaceId: s.wid, email: l.email, reason },
          update: { reason },
        })
      )
    );
    await prisma.lead.updateMany({ where: { id: { in: foundIds } }, data: { status: "suppressed" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "unsuppress") {
    // Remove suppressions + mark lead active
    const emails = leads.map((l) => l.email);
    await prisma.suppression.deleteMany({ where: { workspaceId: s.wid, email: { in: emails } } });
    await prisma.lead.updateMany({ where: { id: { in: foundIds }, workspaceId: s.wid }, data: { status: "active" } });
    return NextResponse.json({ ok: true });
  }

  if (action === "enroll_campaign") {
    const campaignId = String(body.campaignId || "");
    if (!campaignId) return NextResponse.json({ ok: false, error: "Missing campaignId" }, { status: 400 });
    const camp = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId: s.wid }, select: { id: true } });
    if (!camp) return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 });
    const now = new Date();
    // createMany + skipDuplicates is supported by Prisma for MySQL
    await prisma.enrollment.createMany({
      data: foundIds.map((leadId) => ({ campaignId, leadId, status: "queued", currentStep: 1, nextRunAt: now })),
      skipDuplicates: true,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "stop_campaigns") {
    // Stop all enrollments for these leads in this workspace
    await prisma.enrollment.updateMany({
      where: {
        leadId: { in: foundIds },
        campaign: { workspaceId: s.wid },
        status: { not: "stopped" },
      },
      data: { status: "stopped", stopReason: "manual" },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    await prisma.lead.deleteMany({ where: { id: { in: foundIds }, workspaceId: s.wid } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
