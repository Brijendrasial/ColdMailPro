export type Role = "owner" | "admin" | "member";

export function normalizeRole(r: string | null | undefined): Role {
  const x = String(r || "member").toLowerCase();
  if (x === "owner") return "owner";
  if (x === "admin") return "admin";
  return "member";
}

export function canManageTeam(role: Role) {
  return role === "owner" || role === "admin";
}

export function canChangeRole(actor: Role, targetCurrent: Role, desired: Role) {
  // Only owner can assign owner or modify owners
  if (desired === "owner" || targetCurrent === "owner") return actor === "owner";
  // Admin can change member/admin
  return actor === "owner" || actor === "admin";
}

export function canRemoveMember(actor: Role, targetRole: Role) {
  if (targetRole === "owner") return actor === "owner";
  return actor === "owner" || actor === "admin";
}
