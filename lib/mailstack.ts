import * as fs from "node:fs";
import * as path from "node:path";

export function splitLines(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export function writeListFile(dir: string, name: string, lines: string[]): string {
  ensureDir(dir);
  const p = path.join(dir, name);
  fs.writeFileSync(p, lines.join("\n") + "\n", "utf8");
  return p;
}

export type TenantFiles = {
  baseDir: string;
  domainsFile: string;
  ipsFile: string;
  usersFile: string;
};

export function writeTenantFiles(opts: {
  tenant: string;
  domains: string[];
  ips: string[];
  users: string[];
}): TenantFiles {
  const baseDir = path.join("/tmp/coldmail-mailstack", opts.tenant);
  const domainsFile = writeListFile(baseDir, "domains.txt", opts.domains);
  const ipsFile = writeListFile(baseDir, "ips.txt", opts.ips);
  const usersFile = writeListFile(baseDir, "users.txt", opts.users);
  return { baseDir, domainsFile, ipsFile, usersFile };
}
