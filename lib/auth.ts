import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { env } from "./env";
import { prisma } from "./prisma";

const encKey = new TextEncoder().encode(env.JWT_SECRET);

type SessionPayload = {
  uid: string;
  wid: string; // current workspace
  sid: string; // session id (device)
};

type TwoFAPendingPayload = { uid: string; wid: string };

const TWOFA_PENDING_COOKIE = `${env.COOKIE_NAME}_2fa_pending`;

export async function createSessionCookie(payload: SessionPayload) {
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(encKey);

  cookies().set(env.COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export type SessionMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

async function createUserSession(uid: string, wid: string, meta?: SessionMeta) {
  const s = await prisma.userSession.create({
    data: {
      userId: uid,
      workspaceId: wid,
      ip: meta?.ip ? String(meta.ip).slice(0, 191) : null,
      userAgent: meta?.userAgent ? String(meta.userAgent).slice(0, 5000) : null,
      lastSeenAt: new Date(),
    },
    select: { id: true },
  });
  return s.id;
}

export async function createDbSessionAndCookie(
  payload: { uid: string; wid: string },
  meta?: SessionMeta
) {
  const sid = await createUserSession(payload.uid, payload.wid, meta);
  await createSessionCookie({ ...payload, sid });
  return sid;
}

export function clearSessionCookie() {
  cookies().set(env.COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(env.COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encKey);
    const uid = String(payload.uid || "");
    const wid = String(payload.wid || "");
    const sid = String(payload.sid || "");
    if (!uid || !wid || !sid) return null;

    // Validate session has not been revoked
    const sess = await prisma.userSession.findFirst({
      where: { id: sid, userId: uid, workspaceId: wid },
      select: { revokedAt: true, lastSeenAt: true },
    });
    if (!sess || sess.revokedAt) return null;

    // Light-touch "last seen" update (every 5 minutes max)
    const now = Date.now();
    const last = sess.lastSeenAt?.getTime?.() ?? 0;
    if (now - last > 5 * 60 * 1000) {
      await prisma.userSession.updateMany({
        where: { id: sid, revokedAt: null, lastSeenAt: { lt: new Date(now - 5 * 60 * 1000) } },
        data: { lastSeenAt: new Date() },
      }).catch(() => null);
    }

    return { uid, wid, sid };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

// --------------------
// 2FA pending session
// --------------------

export async function createTwoFAPendingCookie(payload: TwoFAPendingPayload) {
  const jwt = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(encKey);

  cookies().set(TWOFA_PENDING_COOKIE, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });
}

export function clearTwoFAPendingCookie() {
  cookies().set(TWOFA_PENDING_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getTwoFAPending(): Promise<TwoFAPendingPayload | null> {
  const token = cookies().get(TWOFA_PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encKey);
    const uid = String(payload.uid || "");
    const wid = String(payload.wid || "");
    if (!uid || !wid) return null;
    return { uid, wid };
  } catch {
    return null;
  }
}

// --------------------
// Login
// --------------------

export async function login(email: string, password: string, meta?: SessionMeta) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      twoFactorEnabled: true,
    },
  });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) return null;

  if (user.twoFactorEnabled) {
    await createTwoFAPendingCookie({ uid: user.id, wid: membership.workspaceId });
    return { id: user.id, email: user.email, name: user.name, requires2fa: true };
  }

  await createDbSessionAndCookie({ uid: user.id, wid: membership.workspaceId }, meta);
  return { id: user.id, email: user.email, name: user.name, requires2fa: false };
}
