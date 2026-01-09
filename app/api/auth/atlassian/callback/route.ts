import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  const baseUrl = process.env.NEXTAUTH_URL || 'https://jingpt-two.vercel.app';

  if (error || !code) {
    console.error('Atlassian OAuth 에러:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=atlassian_failed`);
  }

  try {
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        code: code,
        redirect_uri: `${baseUrl}/api/auth/atlassian/callback`,
      }),
    });

    if (!tokenRes.ok) {
      const errorData = await tokenRes.json();
      console.error('Atlassian 토큰 교환 실패:', errorData);
      return NextResponse.redirect(`${baseUrl}/login?error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    console.log('Atlassian 토큰 발급 성공');
    
    // 쿠키와 함께 리다이렉트
    const response = NextResponse.redirect(`${baseUrl}/login?atlassian=success`);
    
    // 쿠키 설정
    response.cookies.set('atlassian_access_token', tokens.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    
    if (tokens.refresh_token) {
      response.cookies.set('atlassian_refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      });
    }

    return response;
    
  } catch (error) {
    console.error('Atlassian OAuth 처리 에러:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_error`);
  }
}
