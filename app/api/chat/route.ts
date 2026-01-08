import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// --- 검색 함수 (기능 유지) ---
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
      body: JSON.stringify({ requests: [{ entityTypes: ['driveItem'], query: { queryString: query } }] }),
    });
    const searchData = await searchRes.json();
    return JSON.stringify(searchData.value[0]?.hitsContainers[0]?.hits?.map((h: any) => h.resource.name) || "검색 결과 없음");
  } catch (e) { return "SharePoint 검색 중 오류 발생"; }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      // 💡 404 에러 해결을 위해 가장 안정적인 모델명으로 변경합니다.
      model: "claude-3-sonnet-20240229", 
      max_tokens: 4096,
      system: `당신은 'Chat진피티'이며, 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.

## 데이터 소스 가이드
1. Confluence: Post-Management (히스토리, PMI, 보드미팅, 보험 정보)
2. SharePoint: Contracts Package (계약서, BCA), 투자사 재무제표 (분기별 재무제표 및 Cap Table)

## 핵심 별칭 매핑
- Coconut horse = Cyancook, The Architects Republic = Arkrep, NB Creative = Cor3
- PCF = People Can Fly, UW = Unknown Worlds 등 인식하여 검색하세요.

## 검색 가이드
- 지분율: SharePoint > 투자사 재무제표 > [최신 분기] > Cap Table (반드시 최신 데이터 확인)
- ROFN/2PP/우선협상권: Confluence 2PP 페이지 또는 SharePoint BCA 계약서 확인.
- 보험(D&O): Confluence 전용 페이지(ID: 651729531) 확인.
- 투자 정보: 회사별 위키 페이지 상단 기본 정보 참조.

## 답변 원칙
- 모든 답변에 출처(Confluence 링크 또는 SharePoint 파일 경로)를 반드시 포함하세요.
- 불확실한 정보는 추측하지 말고 찾을 수 없다고 답변하세요.`,
      messages: messages,
      tools: [
        { name: "search_confluence", description: "컨플루언스 지식 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { name: "search_sharepoint", description: "쉐어포인트 파일 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      const toolResult = toolCall.name === 'search_confluence' ? await searchConfluence(toolCall.input.query) : await searchSharePoint(toolCall.input.query);

      const finalResponse = await anthropic.messages.create({
        model: "claude-3-sonnet-20240229",
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
