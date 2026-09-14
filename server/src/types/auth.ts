// The user shape it is safe to send to the client or attach to a request -
// notably, no passwordHash.
export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
