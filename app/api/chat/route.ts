import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs'; // 환경 설정 강제

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 크래프톤 포트폴리오사 지식베이스 전문 어시스턴트입니다.
      - 지분율: SharePoint 최신 Cap Table 참조.
      - ROFN/2PP: BCA 계약서 및 Confluence 전용 페이지 참조.
      - 별칭 인식: Cyancook(Coconut horse), Arkrep(The Architects Republic) 등.
      - 반드시 출처를 명시하세요.`,
      messages: messages,
    });

    return new Response(JSON.stringify({ content: response.content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
