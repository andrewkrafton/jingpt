import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  console.log('=== Atlassian Callback Started ===');
  
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const baseUrl = process.env.NEXTAUTH_URL || 'https://jingpt-two.vercel.app';
  
  console.log('Base URL:', baseUrl);
  console.log('Code received:', !!code);
  console.log('Error:', error);
  console.log('Error description:', errorDescription);

  if (error || !code) {
    console.error('Atlassian OAuth 에러:', error, errorDescription);
    return NextResponse.redirect(`${baseUrl}/login?error=atlassian_failed&reason=${error}`);
  }

  try {
    console.log('Exchanging code for token...');
    
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

    console.log('Token response status:', tokenRes.status);

    if (!tokenRes.ok) {
      const errorData = await tokenRes.json();
      console.error('Atlassian 토큰 교환 실패:', JSON.stringify(errorData));
      return NextResponse.redirect(`${baseUrl}/login?error=token_exchange_failed`);
    }

    const tokens = await tokenRes.json();
    console.log('Token received successfully');
    console.log('Access token length:', tokens.access_token?.length);
    console.log('Has refresh token:', !!tokens.refresh_token);
    
    // 리다이렉트 응답 생성
    const response = NextResponse.redirect(`${baseUrl}/login?atlassian=success`);
    
    // 쿠키 설정
    response.cookies.set({
      name: 'atlassian_access_token',
      value: tokens.access_token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    });
    
    if (tokens.refresh_token) {
      response.cookies.set({
        name: 'atlassian_refresh_token',
        value: tokens.refresh_token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      });
    }

    console.log('Cookies set, redirecting to login page');
    return response;
    
  } catch (error) {
    console.error('Atlassian OAuth 처리 에러:', error);
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_error`);
  }
}
