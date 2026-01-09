import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const cookieStore = cookies();
    const atlassianToken = cookieStore.get('atlassian_access_token');
    
    console.log('=== Atlassian Status Check ===');
    console.log('Cookie exists:', !!atlassianToken);
    console.log('Cookie value length:', atlassianToken?.value?.length || 0);
    
    return NextResponse.json({
      connected: !!atlassianToken?.value,
      debug: {
        hasCookie: !!atlassianToken,
        tokenLength: atlassianToken?.value?.length || 0
      }
    });
  } catch (error) {
    console.error('Status check error:', error);
    return NextResponse.json({ connected: false, error: 'status_check_failed' });
  }
}
