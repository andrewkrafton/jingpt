import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true });
  
  // Atlassian 쿠키 삭제
  response.cookies.set({
    name: 'atlassian_access_token',
    value: '',
    maxAge: 0,
    path: '/',
  });
  
  response.cookies.set({
    name: 'atlassian_refresh_token',
    value: '',
    maxAge: 0,
    path: '/',
  });
  
  return response;
}
