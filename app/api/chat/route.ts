import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// --- 도구 1: Confluence 검색 함수 ---
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

// --- 도구 2: SharePoint 검색 함수 (Microsoft Graph) ---
async function searchSharePoint(query: string) {
  try {
    // 1. 액세스 토큰 받기
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

    // 2. 검색 수행 (Contracts 및 재무제표 범위)
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

    // 1. Claude에게 질문과 도구 목록 전달
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-latest", // Enterprise 계정이므로 최신 모델 시도
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.
      - 별칭: Cyancook(Coconut horse), Arkrep(The Architects Republic), Cor3(NB Creative) 등 인식.
      - 지분율은 SharePoint 최신 Cap Table을 검색하여 답변하세요.
      - 반드시 검색 결과에 기반한 구체적인 정보와 출처 링크를 포함하세요.`,
      messages: messages,
      tools: [
        {
          name: "search_confluence",
          description: "컨플루언스에서 회사 히스토리, PMI, 보드미팅 메모를 검색합니다.",
          input_schema: { type: "object", properties: { query: { type: "string" } } }
        },
        {
          name: "search_sharepoint",
          description: "쉐어포인트에서 계약서(BCA), 재무제표, Cap Table 파일을 검색합니다.",
          input_schema: { type: "object", properties: { query: { type: "string" } } }
        }
      ]
    });

    // 2. Claude가 도구 사용을 요청했는지 확인 (Tool Use Loop)
    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      let toolResult = "";

      if (toolCall.name === 'search_confluence') toolResult = await searchConfluence(toolCall.input.query);
      if (toolCall.name === 'search_sharepoint') toolResult = await searchSharePoint(toolCall.input.query);

      // 3. 검색 결과를 들고 다시 Claude에게 최종 답변 요청
      const finalResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-latest",
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
