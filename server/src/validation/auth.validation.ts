import { z } from "zod";

// 72 chars is a generous upper bound for a passphrase; it exists to stop
// pathologically long input from making password hashing artificially
// expensive, not because Argon2 itself has a length limit.
export const signupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(72),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
