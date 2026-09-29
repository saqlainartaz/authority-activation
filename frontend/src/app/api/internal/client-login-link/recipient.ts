export function selectLinkRecipient(users: readonly { id: string }[], requestedId: unknown): string | null {
  if (requestedId === undefined) return users[0]?.id ?? null;
  if (typeof requestedId !== "string" || !requestedId.trim()) return null;
  return users.some((user) => user.id === requestedId) ? requestedId : null;
}
