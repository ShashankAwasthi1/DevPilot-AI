import { Prisma, User } from "@prisma/client";
import { SESSION_TTL_MS } from "../config/auth";
import { prisma } from "../config/prisma";
import type { SafeUser } from "../types/auth";
import { AppError } from "../utils/AppError";
import { hashPassword, verifyPassword } from "../utils/password";
import { generateSessionToken, hashSessionToken } from "../utils/sessionToken";
import type { LoginInput, SignupInput } from "../validation/auth.validation";

interface IssuedSession {
  token: string;
  expiresAt: Date;
}

// A valid Argon2id hash of an unrelated, fixed password - used only so that
// "no such user" and "wrong password" take the same amount of time. Without
// this, skipping verification for a non-existent email would let an
// attacker fingerprint registered addresses by response latency alone.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$yvElD9DOyqbwQmONmmAuzw$PeZTOcS/f2Gmgo98F6LA4z5NyvhK26QuEne61P1j5v8";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function createSession(userId: string): Promise<IssuedSession> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token, expiresAt };
}

export async function signup(
  input: SignupInput,
): Promise<{ user: SafeUser; session: IssuedSession }> {
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password);

  let user: User;
  try {
    user = await prisma.user.create({
      data: { email, name: input.name, passwordHash },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new AppError(409, "An account with this email already exists");
    }
    throw err;
  }

  const session = await createSession(user.id);

  return { user: toSafeUser(user), session };
}

export async function login(
  input: LoginInput,
): Promise<{ user: SafeUser; session: IssuedSession }> {
  const email = normalizeEmail(input.email);

  const user = await prisma.user.findUnique({ where: { email } });

  // Always verify against *some* Argon2id hash - the user's real one if
  // they exist, otherwise the dummy - so this call takes the same time
  // either way and the branch below can't be timed to detect user existence.
  const validPassword = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);

  if (!user || !validPassword) {
    throw new AppError(401, "Invalid email or password");
  }

  const session = await createSession(user.id);

  return { user: toSafeUser(user), session };
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function getUserForSessionToken(token: string): Promise<SafeUser | null> {
  const tokenHash = hashSessionToken(token);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt <= new Date()) {
    // Lazily clean up the expired row; a missed cleanup here is harmless
    // since expired sessions are already rejected above.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  return toSafeUser(session.user);
}
