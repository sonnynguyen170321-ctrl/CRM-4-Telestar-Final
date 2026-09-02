import { getOAuthProviderConfig, type OAuthProvider } from "./providers";

// S6c: build the provider authorize URL for the Authorization Code + PKCE flow.
// Only PUBLIC values go on this URL: client_id, redirect_uri, scope, state, and
// the S256 code_challenge. The client_secret and the code_verifier are NEVER
// placed here (the secret stays server-side; the verifier is exchanged later).

export type BuildAuthorizeUrlInput = {
  provider: OAuthProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
};

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const config = getOAuthProviderConfig(input.provider);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: config.scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    ...config.extraAuthorizeParams,
  });
  if (input.loginHint) {
    params.set("login_hint", input.loginHint);
  }
  return `${config.authorizeUrl}?${params.toString()}`;
}
