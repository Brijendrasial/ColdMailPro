import { prisma } from "@/lib/prisma";

export async function enqueueJob(type: string, payload: any, runAt: Date) {
  await prisma.job.create({
    data: {
      type,
      payload: JSON.stringify(payload ?? {}),
      runAt,
      status: "queued",
    },
  });
}
