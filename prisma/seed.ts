import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@local.test";
  const password = "Admin@12345";
  const passwordHash = await bcrypt.hash(password, 10);

  // 1) Admin user (idempotent)
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Admin", passwordHash },
  });

  // 2) Workspace + membership (idempotent)
  let membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });

  let ws = membership?.workspace || null;
  if (!ws) {
    // try to re-use an existing workspace named Default Workspace if present
    ws = await prisma.workspace.findFirst({ where: { name: "Default Workspace" }, orderBy: { createdAt: "asc" } });
    if (!ws) {
      ws = await prisma.workspace.create({ data: { name: "Default Workspace" } });
    }
    await prisma.membership.create({
      data: { userId: user.id, workspaceId: ws.id, role: "owner" },
    });
  }

  // 3) MailstackConfig (idempotent)
  if ((prisma as any).mailstackConfig) {
    await (prisma as any).mailstackConfig.upsert({
      where: { workspaceId: ws.id },
      update: {},
      create: { workspaceId: ws.id },
    });
  }

  // 4) Sample campaign (idempotent)
  const existingCamp = await prisma.campaign.findFirst({
    where: { workspaceId: ws.id, name: "Sample Campaign" },
  });

  const camp = existingCamp ||
    (await prisma.campaign.create({
      data: { workspaceId: ws.id, name: "Sample Campaign", status: "draft" },
    }));

  const steps = await prisma.sequenceStep.findMany({
    where: { campaignId: camp.id },
    orderBy: { stepNumber: "asc" },
    take: 5,
  });

  if (steps.length === 0) {
    await prisma.sequenceStep.createMany({
      data: [
        {
          campaignId: camp.id,
          stepNumber: 1,
          delayDays: 0,
          subjectTpl: "Quick question, {{firstName}}",
          bodyTpl: "Hi {{firstName}},\n\nJust reaching out because ...\n\n— {{senderName}}",
          isReply: false,
        },
        {
          campaignId: camp.id,
          stepNumber: 2,
          delayDays: 2,
          subjectTpl: "Re: Quick question",
          bodyTpl: "Hi {{firstName}},\n\nJust bumping this in case you missed it.\n\n— {{senderName}}",
          isReply: true,
        },
      ],
    });
  }

  console.log("Seeded:");
  console.log("  user:", email, "password:", password);
  console.log("  workspace:", ws.name, ws.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
