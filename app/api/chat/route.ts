import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      // 💡 모델 이름을 'latest'로 변경하여 호환성 문제를 해결합니다.
      model: "claude-3-5-sonnet-latest", 
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.

## 데이터 소스 및 검색 가이드
1. Confluence: https://krafton.atlassian.net/wiki/spaces/CORPDEV/pages/246364475/Post-Management (회사별 히스토리, PMI)
2. SharePoint (Contracts Package): 계약서, BCA 관련 정보
3. SharePoint (투자사 재무제표): [최신 분기 폴더] > [회사명] > Cap Table 및 재무제표

## 핵심 규칙
- 지분율: 반드시 최신 분기 Cap Table(예: 2025 Q3)을 참조.
- ROFN, 2PP: BCA 계약서 또는 Confluence 2PP 페이지 확인.
- 별칭 인식: Cyancook(Coconut horse), Arkrep(The Architects Republic), Cor3(NB Creative) 등.
- 반드시 답변에 출처(링크 또는 파일명)를 포함하세요.`,
      messages: messages,
    });

    return new Response(JSON.stringify({ content: response.content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    // API 에러 발생 시 상세 내용을 화면에 전달
    console.error("Anthropic API Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
