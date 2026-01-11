import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function Nav() {
  const s = await getSession();
  if (!s) return null;

  const ws = await prisma.workspace.findUnique({ where: { id: s.wid } });

  const items = [
    { href: "/app", label: "Dashboard" },
    { href: "/app/campaigns", label: "Campaigns" },
    { href: "/app/leads", label: "Leads" },
    { href: "/app/mailboxes", label: "Mailboxes" },
    { href: "/app/domains", label: "Domains" },
    { href: "/app/mailstack", label: "Mailstack" },
    { href: "/app/logs", label: "Logs" },
    { href: "/app/analytics", label: "Analytics" },
    { href: "/app/replies", label: "Replies" },
    { href: "/app/settings", label: "Settings" },
  ];

  return (
    <div className="border-b border-black/10 dark:border-white/10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="font-bold">ColdMail Pro</div>
          <div className="text-xs opacity-70">{ws?.name || ""}</div>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="text-sm opacity-85 hover:opacity-100">
              {i.label}
            </Link>
          ))}
          <form action="/api/auth/logout" method="post">
            <button className="text-sm opacity-85 hover:opacity-100">Logout</button>
          </form>
        </div>
      </div>
    </div>
  );
}
