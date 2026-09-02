export type V2AuthIdentity = {
  provider: "local";
  email: string;
  emailNormalized: string;
  emailVerified: true;
  name?: string | null;
  pictureUrl?: string | null;
};

export type V2AuthErrorCode =
  | "UNAUTHENTICATED"
  | "AUTH_IDENTITY_INVALID";

export class V2AuthError extends Error {
  code: V2AuthErrorCode;

  constructor(code: V2AuthErrorCode, message: string) {
    super(message);
    this.name = "V2AuthError";
    this.code = code;
  }
}