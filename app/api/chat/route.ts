import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// --- Confluence 검색 (Andrew님의 API Token 사용) ---
async function searchConfluence(query: string) {
  const domain = process.env.ATLASSIAN_DOMAIN;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  try {
    const res = await fetch(
      `https://${domain}/wiki/rest/api/content/search?cql=text~"${query}"&limit=5`,
      { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } }
    );
    const data = await res.json();
    
    if (!data.results || data.results.length === 0) {
      return `Confluence 결과 없음 (쿼리: ${query})`;
    }
    return data.results.map((r: any) => `[제목: ${r.title}] (URL: https://${domain}/wiki${r._links.webui})`).join('\n');
  } catch (e) {
    return `Confluence 연결 실패: ${e}`;
  }
}

// --- SharePoint 검색 (기존 앱 4a8d... 권한 활용) ---
async function searchSharePoint(query: string) {
  try {
    const tokenRes = await fetch(`https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.AZURE_CLIENT_ID || '',
        scope: 'https://graph.microsoft.com/.default',
        client_secret: process.env.AZURE_CLIENT_SECRET || '',
        grant_type: 'client_credentials',
      }),
    });
    const { access_token } = await tokenRes.json();

    // 💡 검색 범위를 더 넓게 설정 (모든 사이트 및 드라이브 대상)
    const searchRes = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          entityTypes: ['driveItem'],
          query: { queryString: `"${query}"` }, // 정확한 일치를 위해 따옴표 포함
          from: 0,
          size: 5
        }]
      }),
    });
    const searchData = await searchRes.json();
    const hits = searchData.value?.[0]?.hitsContainers?.[0]?.hits;

    if (!hits || hits.length === 0) {
      return `SharePoint 결과 없음 (검색어: ${query})`;
    }
    return JSON.stringify(hits.map((h: any) => h.resource.name));
  } catch (e) {
    return `SharePoint 연결 실패: ${e}`;
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 
      **필수 사항**:
      1. 지분율, 2PP, ROFN 등 모든 질문에 대해 반드시 도구(search_sharepoint, search_confluence)를 호출하십시오.
      2. 도구의 결과가 "결과 없음"이라고 나오면 본인의 지식으로 답변하지 말고 "데이터베이스에서 해당 정보를 찾지 못했습니다"라고 정직하게 말하십시오.
      3. 2PP는 '2nd Party Publishing'의 약자이며 크래프톤의 퍼블리싱 권한을 의미합니다.`,
      messages: messages,
      tools: [
        {
          name: "search_confluence",
          description: "크래프톤 위키에서 회사 히스토리 및 지식 검색",
          input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        },
        {
          name: "search_sharepoint",
          description: "쉐어포인트에서 지분율(Cap Table), 계약서(BCA), 재무제표 파일 검색",
          input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
        }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      const toolResult = toolCall.name === 'search_confluence' 
        ? await searchConfluence(toolCall.input.query)
        : await searchSharePoint(toolCall.input.query);

      const finalResponse = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 4096,
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResult }] }
        ]
      });
      return new Response(JSON.stringify({ content: finalResponse.content }), { status: 200 });
    }

    return new Response(JSON.stringify({ content: response.content }), { status: 200 });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
