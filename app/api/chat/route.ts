import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// 1. Confluence 검색 함수
async function searchConfluence(query: string) {
  const domain = process.env.ATLASSIAN_DOMAIN;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  const response = await fetch(
    `https://${domain}/wiki/rest/api/content/search?cql=text~"${query}"&limit=3`,
    { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } }
  );
  const data = await response.json();
  return JSON.stringify(data.results.map((r: any) => ({ title: r.title, url: `https://${domain}/wiki${r._links.webui}` })));
}

// 2. SharePoint 검색 함수 (Microsoft Graph API)
async function searchSharePoint(query: string) {
  // 실제 구현 시에는 Azure AD 토큰 발급 로직이 필요하지만, 
  // 여기서는 구조적 답변을 위해 검색 위치를 가이드하는 로그를 반환하도록 세팅합니다.
  return `SharePoint 검색 수행: "${query}" 범위 (Contracts Package, 투자사 재무제표)`;
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4096,
    system: `당신은 'Chat진피티'입니다. 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.

## 데이터 소스 (이 범위 내에서만 검색)
1. Confluence 위키 (Post-Management): 각 포트폴리오사별 히스토리, PMI 현황, 보드미팅 메모 등.
2. SharePoint - Contracts Package: 포트폴리오사별 계약서, BCA 관련 문서.
3. SharePoint - 투자사 재무제표: 분기별 포트폴리오사 재무제표 (Cap Table 포함).

## 검색 및 답변 가이드
- 지분율: 반드시 SharePoint의 최신 분기 'Cap Table' 참조.
- ROFN, 2PP, 퍼블리싱권한: BCA 계약서 또는 Confluence 2PP 페이지 확인.
- 별칭 인식: Coconut horse=Cyancook, Arkrep=The Architects Republic, Cor3=NB Creative 등 인식.
- 출처 명시: 모든 답변에 Confluence 링크 또는 SharePoint 파일 경로를 반드시 포함할 것.`,
    messages: messages,
    tools: [
      {
        name: "search_confluence",
        description: "컨플루언스에서 사내 지식 및 회사 히스토리를 검색합니다.",
        input_schema: { type: "object", properties: { query: { type: "string" } } }
      },
      {
        name: "search_sharepoint",
        description: "쉐어포인트에서 계약서 및 재무제표 파일을 검색합니다.",
        input_schema: { type: "object", properties: { query: { type: "string" } } }
      }
    ]
  });

  // 클라이언트에게 답변 반환
  return Response.json({ content: response.content });
}
