# Identity Provider (IdP / OpenID Connect) Authentication

**Home Cockpit** includes a native, zero-dependency **OpenID Connect (OIDC)** authentication layer alongside the built-in `APP_PASSWORD` option. Any standard OIDC provider is supported (Google, Authentik, Keycloak, Authelia, Microsoft Entra ID, Auth0, etc.).

---

## Security Architecture

- **OIDC Discovery:** Automatically resolves `authorization_endpoint`, `token_endpoint`, `jwks_uri`, and optional `userinfo_endpoint` from `${AUTH_OIDC_ISSUER}/.well-known/openid-configuration`.
- **PKCE (`S256`) + Dual Anti-CSRF Transaction:** Generates a fresh `code_verifier`/`code_challenge` pair and signs both the OAuth `state` and an HttpOnly `hc_oidc_tx` cookie with an HMAC-SHA256 transaction key (`10 min` TTL).
- **Cryptographic `id_token` Verification:** Validates JWT signatures directly against the provider's JWKS public keys (`RS256`, `RS384`, `RS512`, `PS256`, `ES256`, `ES384`, `ES512`) plus `iss`, `aud`/`azp`, `exp`, `iat`, and `nonce`.
- **Fail-Closed Access Control:** Requires explicit allow-listing via `AUTH_ALLOWED_EMAILS` and/or `AUTH_ALLOWED_DOMAINS` (with verified emails only), unless `AUTH_ALLOW_ANY_AUTHENTICATED="true"` is deliberately set for a private self-hosted IdP.
- **Unified Signed Cockpit Session:** Once verified, Home Cockpit issues the standard HttpOnly HMAC-signed `hc_session` (`v3`) cookie containing only minimal user identity metadata (`email`, `name`, `provider`, `sub`).

---

## Quick Start Example: Google (OIDC)

Using Google lets you protect your cockpit with personal Google accounts (`@gmail.com`) or a Google Workspace domain without managing passwords.

> **Important:** Keep these OIDC login credentials (`AUTH_OIDC_CLIENT_*`) separate from `GOOGLE_CLIENT_*` (which grants device telemetry access for Google Home / Nest).

### 1. Create a Google Cloud OAuth Web Client

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **Google Auth Platform** (or **APIs & Services → Credentials**).
2. Configure the OAuth consent screen (**External** for personal Gmail accounts, or **Internal** for Google Workspace). Only basic OpenID scopes (`openid`, `email`, `profile`) are needed.
3. Click **Create Credentials → OAuth client ID** and choose **Web application**.
4. Under **Authorized redirect URIs**, add:
   - Production: `https://<your-domain>/api/auth/oidc/callback`
   - Local dev (optional): `http://localhost:3000/api/auth/oidc/callback`
5. Copy the generated **Client ID** and **Client Secret**.

### 2. Configure Environment Variables

Add to `.env.local` (or Vercel Project Environment Variables):

```env
AUTH_OIDC_ISSUER="https://accounts.google.com"
AUTH_OIDC_CLIENT_ID="your-login-client.apps.googleusercontent.com"
AUTH_OIDC_CLIENT_SECRET="GOCSPX-your-login-client-secret"
AUTH_OIDC_PROVIDER_NAME="Google"

# Allow-list required in production when using a public IdP like Google:
AUTH_ALLOWED_EMAILS="alice@gmail.com,bob@gmail.com"
# AUTH_ALLOWED_DOMAINS="example.com"

# Dedicated secret to sign hc_session cookies (required in production if APP_PASSWORD is unset):
AUTH_SESSION_SECRET="replace-with-64-char-random-hex"
```

Generate a strong `AUTH_SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Verify Sign-In

1. Restart the server (or redeploy on Vercel) and navigate to `/login`.
2. Click **Sign in with Google** → authenticate with Google → you are redirected back to `/` with your identity shown in the cockpit header.

---

## Self-Hosted & Enterprise IdP Presets

| Provider | Example `AUTH_OIDC_ISSUER` | Redirect URI to Register | Notes |
| :--- | :--- | :--- | :--- |
| **Google** | `https://accounts.google.com` | `https://<domain>/api/auth/oidc/callback` | Always set `AUTH_ALLOWED_EMAILS` or `AUTH_ALLOWED_DOMAINS` |
| **Authentik** | `https://auth.example.com/application/o/home-cockpit` | `https://<domain>/api/auth/oidc/callback` | Can use `AUTH_ALLOW_ANY_AUTHENTICATED="true"` if access is gated in Authentik |
| **Keycloak** | `https://sso.example.com/realms/<realm>` | `https://<domain>/api/auth/oidc/callback` | Standard Confidential or PKCE Public client supported |
| **Authelia** | `https://auth.example.com` | `https://<domain>/api/auth/oidc/callback` | Uses PKCE `S256` and `RS256` JWKS verification |
| **Microsoft Entra ID** | `https://login.microsoftonline.com/<tenant-id>/v2.0` | `https://<domain>/api/auth/oidc/callback` | Use tenant-specific issuer UUID |
| **Auth0** | `https://<tenant>.auth0.com` | `https://<domain>/api/auth/oidc/callback` | Set `AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_DOMAINS` |

---

## Coexistence with `APP_PASSWORD`

| `APP_PASSWORD` | `AUTH_OIDC_ISSUER` + `CLIENT_ID` | Behavior on `/login` & Middleware |
| :--- | :--- | :--- |
| Set | Unset | Classic password form (`hc_session` v2) |
| Unset | Set | SSO IdP button only (requires `AUTH_SESSION_SECRET` / `TOKEN_ENCRYPTION_KEY` / `SCHEDULE_SECRET` in production) |
| Set | Set | **Both enabled** — IdP SSO button + fallback `APP_PASSWORD` form |
| Unset | Unset | **Production:** blocked (`503`) · **Local dev:** open without login |

---

## Troubleshooting

- **`oidc_unauthorized` on `/login`:** Your account's email is missing from `AUTH_ALLOWED_EMAILS` / `AUTH_ALLOWED_DOMAINS`, or the provider returned `email_verified: false`.
- **`oidc_config` in production:** Either `AUTH_OIDC_*` is missing `https://`, `AUTH_SESSION_SECRET` is missing without `APP_PASSWORD`, or no `AUTH_ALLOWED_*` rule was set (and `AUTH_ALLOW_ANY_AUTHENTICATED` is not `"true"`).
- **`oidc_csrf`:** The `hc_oidc_tx` cookie expired (`> 10 min`) or browser cookies were blocked / mismatched host (`NEXT_PUBLIC_APP_URL` vs callback URL).
- **`oidc_failed`:** Check Vercel/server logs for `[api/auth/oidc/callback]` details (e.g., mismatched client secret or unregistered Redirect URI).
