import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// --- 검색 함수 (기존과 동일) ---
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
    return data.results.map((r: any) => `[제목: ${r.title}] (URL: https://${domain}/wiki${r._links.webui})`).join('\n');
  } catch (e) { return "Confluence 검색 중 오류 발생"; }
}

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
    const searchRes = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ entityTypes: ['driveItem'], query: { queryString: query } }]
      }),
    });
    const searchData = await searchRes.json();
    return JSON.stringify(searchData.value[0]?.hitsContainers[0]?.hits?.map((h: any) => h.resource.name) || "검색 결과 없음");
  } catch (e) { return "SharePoint 검색 중 오류 발생"; }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // 1. 첫 번째 호출: 질문 분석 및 도구 사용 결정
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.
      - 지침: 지분율은 최신 Cap Table(SharePoint) 참조, ROFN/2PP는 BCA(SharePoint) 또는 Confluence 확인.
      - 별칭: Cyancook(Coconut horse), Arkrep(The Architects Republic) 등 완벽히 인식.
      - 반드시 검색 결과를 바탕으로 답변하고 출처를 명시할 것.`,
      messages: messages,
      tools: [
        {
          name: "search_confluence",
          description: "컨플루언스에서 회사 히스토리, PMI, 보드미팅 메모를 검색합니다.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"]
          }
        },
        {
          name: "search_sharepoint",
          description: "쉐어포인트에서 계약서(BCA), 재무제표, Cap Table 파일을 검색합니다.",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"]
          }
        }
      ]
    });

    // 2. 도구 사용 로직 처리
    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      const toolResult = toolCall.name === 'search_confluence' 
        ? await searchConfluence(toolCall.input.query)
        : await searchSharePoint(toolCall.input.query);

      const finalResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 4096,
        system: "검색된 정보를 바탕으로 질문에 정확히 답변하세요.",
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: toolResult
            }]
          }
        ]
      });
      return new Response(JSON.stringify({ content: finalResponse.content }), { status: 200 });
    }

    return new Response(JSON.stringify({ content: response.content }), { status: 200 });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
