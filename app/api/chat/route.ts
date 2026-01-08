import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// --- 검색 엔진 함수 (Confluence & SharePoint) ---
async function searchConfluence(query: string) {
  const domain = process.env.ATLASSIAN_DOMAIN;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  try {
    const res = await fetch(`https://${domain}/wiki/rest/api/content/search?cql=text~"${query}"&limit=5`,
      { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } });
    const data = await res.json();
    return data.results.map((r: any) => `[제목: ${r.title}] (URL: https://${domain}/wiki${r._links.webui})`).join('\n');
  } catch (e) { return "Confluence 검색 오류"; }
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
      body: JSON.stringify({ requests: [{ entityTypes: ['driveItem'], query: { queryString: query } }] }),
    });
    const searchData = await searchRes.json();
    return JSON.stringify(searchData.value[0]?.hitsContainers[0]?.hits?.map((h: any) => h.resource.name) || "검색 결과 없음");
  } catch (e) { return "SharePoint 검색 오류"; }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // 💡 404 에러 방지를 위해 확실히 작동하는 Haiku 모델 사용
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307", 
      max_tokens: 4096,
      system: `당신은 'Chat진피티'이며, 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.

## 데이터 소스 범위
1. Confluence 위키 (Post-Management): 히스토리, PMI 현황, 보드미팅 메모, 보험 정보.
2. SharePoint (Contracts Package): 계약서(BCA), PMI 문서.
3. SharePoint (투자사 재무제표): 분기별 재무제표 및 Cap Table.

## 별칭 및 약자 정보
- Coconut horse = Cyancook, The Architects Republic = Arkrep, NB Creative = Cor3.
- PCF = People Can Fly, UW = Unknown Worlds.

## 검색 가이드
- **지분율**: SharePoint 투자사 재무제표 내 '최신 분기' Cap Table을 최우선 검색.
- **ROFN/2PP**: Confluence 스튜디오 위키 및 2PP 페이지 확인 후 SharePoint BCA 계약서 참조.
- **보험(D&O)**: Confluence 전용 페이지(ID: 651729531) 확인.

## 답변 원칙
- 반드시 출처(Confluence 링크 또는 SharePoint 파일명)를 답변에 포함하세요.
- 숫자는 정확하게, 답변은 간결하고 명확하게 작성하세요.`,
      messages: messages,
      tools: [
        { name: "search_confluence", description: "사내 지식 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { name: "search_sharepoint", description: "파일 및 재무 데이터 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      const toolResult = toolCall.name === 'search_confluence' ? await searchConfluence(toolCall.input.query) : await searchSharePoint(toolCall.input.query);

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
