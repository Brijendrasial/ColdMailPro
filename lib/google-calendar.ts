import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt, randomToken } from "@/lib/crypto";
import { google } from "googleapis";

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function googleOauthEnabled(): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function googleOauthRedirectUrl(): string {
  if (env.GOOGLE_OAUTH_REDIRECT_URL) return env.GOOGLE_OAUTH_REDIRECT_URL;
  const base = String(env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  return `${base}/api/integrations/google/callback`;
}

export function googleOauthScopes(): string[] {
  const raw = String(env.GOOGLE_OAUTH_SCOPES || "").trim();
  if (!raw) return DEFAULT_SCOPES;
  return raw.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

export function googleOAuthClient() {
  if (!googleOauthEnabled()) throw new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
  return new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, googleOauthRedirectUrl());
}

export async function upsertGoogleCalendarAccount(args: {
  workspaceId: string;
  connectedByUserId: string;
  googleEmail: string | null;
  refreshToken: string;
  scope?: string | null;
}) {
  const row = await prisma.googleCalendarAccount.upsert({
    where: { workspaceId: args.workspaceId },
    create: {
      workspaceId: args.workspaceId,
      connectedByUserId: args.connectedByUserId,
      googleEmail: args.googleEmail,
      refreshTokenEnc: encrypt(args.refreshToken),
      scope: args.scope || null,
    },
    update: {
      connectedByUserId: args.connectedByUserId,
      googleEmail: args.googleEmail,
      refreshTokenEnc: encrypt(args.refreshToken),
      scope: args.scope || null,
    },
    select: { id: true, workspaceId: true, googleEmail: true, scope: true },
  });
  return row;
}

export async function getGoogleCalendarAccount(workspaceId: string) {
  return prisma.googleCalendarAccount.findUnique({
    where: { workspaceId },
    select: { id: true, workspaceId: true, googleEmail: true, refreshTokenEnc: true, scope: true, updatedAt: true },
  });
}

export async function disconnectGoogleCalendar(workspaceId: string) {
  await prisma.googleCalendarAccount.delete({ where: { workspaceId } }).catch(() => null);
}

export async function createGoogleMeetEvent(args: {
  workspaceId: string;
  summary: string;
  description?: string | null;
  attendeeEmail: string;
  startIso: string;
  endIso: string;
  timezone?: string | null;
}) {
  const acct = await getGoogleCalendarAccount(args.workspaceId);
  if (!acct) throw new Error("GOOGLE_NOT_CONNECTED");

  const refreshToken = decrypt(acct.refreshTokenEnc);
  const oauth2 = googleOAuthClient();
  oauth2.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: "v3", auth: oauth2 });

  const requestId = randomToken(16);
  const tz = args.timezone || "UTC";

  const res = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: args.summary,
      description: args.description || undefined,
      start: { dateTime: args.startIso, timeZone: tz },
      end: { dateTime: args.endIso, timeZone: tz },
      attendees: [{ email: args.attendeeEmail }],
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const ev: any = res.data || {};
  const meetLink = ev?.hangoutLink || (ev?.conferenceData?.entryPoints || []).find((p: any) => p?.entryPointType === "video")?.uri || null;

  return {
    eventId: String(ev.id || ""),
    htmlLink: ev.htmlLink ? String(ev.htmlLink) : null,
    meetLink: meetLink ? String(meetLink) : null,
    start: ev?.start?.dateTime ? String(ev.start.dateTime) : args.startIso,
    end: ev?.end?.dateTime ? String(ev.end.dateTime) : args.endIso,
  };
}
