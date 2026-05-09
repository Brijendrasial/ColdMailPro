import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { execSync } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isIPv4(ip: string) {
  return /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);
}

function isPrivateIPv4(ip: string) {
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4) return true;
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;

  const a = parts[0];
  const b = parts[1];

  // loopback
  if (a === 127) return true;
  // RFC1918
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // link-local
  if (a === 169 && b === 254) return true;
  // CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs));
}

function parseIpAddrs(output: string): string[] {
  const out: string[] = [];
  const lines = String(output || "").split(/\r?\n/);
  for (const line of lines) {
    // ip -4 -o addr ... => ... inet 1.2.3.4/24 ...
    const m = line.match(/\binet\s+(\d+\.\d+\.\d+\.\d+)\//);
    if (m?.[1] && isIPv4(m[1])) out.push(m[1]);
  }
  return uniq(out);
}

function tryCmd(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

export async function GET() {
  await requireSession();

  // Prefer "ip" output (most accurate on Linux), fallback to hostname -I.
  const out1 = tryCmd("ip -4 -o addr show scope global");
  const out2 = out1 ? "" : tryCmd("ip -4 -o addr show");
  const ipsFromIp = parseIpAddrs(out1 || out2);

  let ips: string[] = ipsFromIp;
  if (!ips.length) {
    const hi = tryCmd("hostname -I");
    ips = uniq(
      String(hi || "")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter(isIPv4)
        .filter((ip) => !ip.startsWith("0."))
    );
  }

  // Separate into public/private for UX.
  const privateIps = uniq(ips.filter((ip) => isPrivateIPv4(ip)));
  const publicIps = uniq(ips.filter((ip) => !isPrivateIPv4(ip)));

  return NextResponse.json({
    ok: true,
    publicIps,
    privateIps,
    allIps: uniq([...publicIps, ...privateIps]),
  });
}
