import { z } from "zod";

export const zEmail = z.string().email();
export const zName = z.string().min(1).max(100);

export function requireBody<T>(data: unknown, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error("BAD_REQUEST: " + msg);
  }
  return parsed.data;
}
