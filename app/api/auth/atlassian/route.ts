import { NextResponse } from 'next/server';

export async function GET() {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/atlassian/callback`;
  
  const authUrl = new URL('https://auth.atlassian.com/authorize');
  authUrl.searchParams.set('audience', 'api.atlassian.com');
  authUrl.searchParams.set('client_id', clientId || '');
  authUrl.searchParams.set('scope', 'read:confluence-space.summary read:confluence-content.all read:confluence-content.summary search:confluence offline_access');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', 'atlassian-oauth');

  return NextResponse.redirect(authUrl.toString());
}
