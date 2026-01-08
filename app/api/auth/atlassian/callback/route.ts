import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    console.error('Atlassian OAuth 에러:', error);
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=atlassian_failed`);
  }

  try {
    // 토큰 교환
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        code: code,
        redirect_uri: `${process.env.NEXTAUTH_URL}/api/auth/atlassian/callback`,
      }),
    });

    if (!tokenRes.ok) {
      const errorData = await tokenRes.json();
      console.error('Atlassian 토큰 교환 실패:', errorData);
      return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    
    // 쿠키에 토큰 저장 (7일)
    const cookieStore = await cookies();
    cookieStore.set('atlassian_access_token', tokens.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7일
      path: '/',
    });
    
    if (tokens.refresh_token) {
      cookieStore.set('atlassian_refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30, // 30일
        path: '/',
      });
    }

    // 로그인 페이지로 리다이렉트
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?atlassian=success`);
    
  } catch (error) {
    console.error('Atlassian OAuth 처리 에러:', error);
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login?error=oauth_error`);
  }
}
