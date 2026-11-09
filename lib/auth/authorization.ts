type AuthorizationUser = { id: string; role: "USER" | "ADMIN" };
export function isAdmin(user: Pick<AuthorizationUser, "role"> | null | undefined) { return user?.role === "ADMIN"; }
export function ownsRecord(user: Pick<AuthorizationUser, "id"> | null | undefined, ownerId: string) { return Boolean(user && user.id === ownerId); }
