// Confluence Cloud ID 가져오기
async function getConfluenceCloudId(accessToken: string): Promise<string | null> {
  try {
    console.log('=== Getting Confluence Cloud ID ===');
    console.log('Token length:', accessToken?.length);
    
    const res = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
    
    console.log('Accessible resources status:', res.status);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('Accessible resources error:', errorText);
      return null;
    }
    
    const sites = await res.json();
    console.log('Sites found:', sites.length);
    console.log('Sites:', JSON.stringify(sites.map((s: any) => ({ id: s.id, url: s.url, name: s.name }))));
    
    const kraftonSite = sites.find((s: any) => s.url.includes('krafton')) || sites[0];
    console.log('Selected site:', kraftonSite?.url);
    
    return kraftonSite?.id || null;
  } catch (error) {
    console.error("Cloud ID 조회 실패:", error);
    return null;
  }
}

// Confluence 검색
async function searchConfluence(query: string, accessToken: string) {
  try {
    console.log('=== Confluence Search Started ===');
    console.log('Query:', query);
    console.log('Token length:', accessToken?.length);
    
    const cloudId = await getConfluenceCloudId(accessToken);
    if (!cloudId) {
      console.error('Cloud ID not found');
      return JSON.stringify({ error: "Confluence 연결 실패. 다시 로그인해주세요." });
    }

    console.log('Cloud ID:', cloudId);

    const cql = encodeURIComponent(`text ~ "${query}" OR title ~ "${query}"`);
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/search?cql=${cql}&limit=10&expand=body.storage,space,version`;
    
    console.log('Search URL:', url);
    
    const res = await fetch(url, { 
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } 
    });

    console.log('Search response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Search error:', errorText);
      return JSON.stringify({ error: "Confluence 검색 실패", detail: errorText });
    }

    const data = await res.json();
    console.log('Search results count:', data.results?.length || 0);
    
    const results = (data.results || []).map((page: any) => ({
      id: page.id,
      title: page.title,
      type: page.type,
      space: page.space?.name || '',
      spaceKey: page.space?.key || '',
      url: `https://krafton.atlassian.net/wiki${page._links?.webui || ''}`,
      lastModified: page.version?.when,
      excerpt: page.body?.storage?.value?.replace(/<[^>]*>/g, ' ').slice(0, 300) || ''
    }));

    if (results.length === 0) {
      return JSON.stringify({ message: `Confluence에서 "${query}" 검색 결과가 없습니다.` });
    }
    return JSON.stringify(results);
  } catch (error: any) {
    console.error('Confluence search error:', error);
    return JSON.stringify({ error: "Confluence 검색 실패", detail: error.message });
  }
}
