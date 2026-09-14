import { User } from "@prisma/client";
import { prisma } from "../config/prisma";
import type { SafeUser } from "../types/auth";
import type { UpdateProfileInput } from "../validation/user.validation";

// The user shape it is safe to send to the client - notably, no passwordHash.
// Shared by auth.service (signup/login/session lookup) and this module
// (profile updates), so there is exactly one place that decides which
// User fields ever leave the server.
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<SafeUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
  });

  return toSafeUser(user);
}
