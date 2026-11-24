import { NextResponse } from 'next/server';
import { isAppPasswordConfigured } from '@/lib/auth';
import { getOidcConfig } from '@/lib/auth-oidc';

export async function GET() {
  const oidc = getOidcConfig();
  return NextResponse.json(
    {
      passwordEnabled: isAppPasswordConfigured(),
      oidcEnabled: oidc.configured,
      oidcProviderName: oidc.configured ? oidc.providerName : null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
