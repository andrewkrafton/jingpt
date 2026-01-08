import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: Request) {
  const { messages } = await req.json();

  const response = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 4096,
    system: `당신은 'Chat진피티'입니다. 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.
    데이터 소스: Confluence(Post-Management), SharePoint(Contracts Package, 투자사 재무제표).
    지침: 지분율은 최신 분기 Cap Table을 참조하고, 모든 답변에는 출처 링크를 포함하세요.
    별칭: Cyancook(Coconut horse), Arkrep(The Architects Republic) 등을 인식하세요.`,
    messages: messages,
    // 여기에 Confluence/SharePoint를 실제로 찌르는 Tool 정의가 들어갑니다.
  });

  return Response.json(response);
}
