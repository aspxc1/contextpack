export interface Session {
  userId: string;
  expiresAt: number;
  revoked: boolean;
}

export function refreshSession(session: Session, now: number): Session {
  if (session.revoked || session.expiresAt <= now) {
    throw new Error('Session expired or revoked');
  }
  return { ...session, expiresAt: now + 60 * 60 * 1000 };
}
