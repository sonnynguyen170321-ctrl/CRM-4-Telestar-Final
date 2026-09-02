// S6c: OAuth provider registry for sender mailbox connection. Only Google and
// Microsoft are supported (the two mailbox providers in the contract §4). SMTP/
// IMAP hosts are the provider defaults used when a sender is created from a
// completed OAuth grant. Scopes request mailbox send + read + offline access so
// we receive a refresh token (encrypted at rest, B1).

export type OAuthProvider = "google" | "microsoft";

export type OAuthProviderConfig = {
  provider: OAuthProvider;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  // Extra authorize params required to receive a refresh token.
  extraAuthorizeParams: Record<string, string>;
};

export const OAUTH_PROVIDERS: Record<OAuthProvider, OAuthProviderConfig> = {
  google: {
    provider: "google",
    label: "Google / Workspace",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://mail.google.com/", "openid", "email"],
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    // access_type=offline + prompt=consent guarantee a refresh_token on re-auth.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    provider: "microsoft",
    label: "Microsoft 365 / Outlook",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [
      "https://outlook.office.com/SMTP.Send",
      "https://outlook.office.com/IMAP.AccessAsUser.All",
      "offline_access",
      "openid",
      "email",
    ],
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    extraAuthorizeParams: { prompt: "consent" },
  },
};

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "microsoft";
}

export function getOAuthProviderConfig(provider: OAuthProvider): OAuthProviderConfig {
  return OAUTH_PROVIDERS[provider];
}
