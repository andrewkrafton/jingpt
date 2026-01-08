import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  const cookieStore = await cookies();
  const atlassianToken = cookieStore.get('atlassian_access_token');
  
  return NextResponse.json({
    connected: !!atlassianToken?.value
  });
}
