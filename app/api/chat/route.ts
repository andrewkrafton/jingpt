import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// SharePoint 검색 및 파일 읽기 함수 (이전 로직 동일)
async function searchSharePoint(query: string, accessToken: string) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ entityTypes: ['driveItem'], query: { queryString: query }, from: 0, size: 10 }]
      }),
    });
    const data = await res.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return `[결과 없음] SharePoint에서 '${query}' 관련 파일을 찾지 못했습니다.`;
    return JSON.stringify(hits.map((h: any) => ({ name: h.resource.name, id: h.resource.id, webUrl: h.resource.webUrl })));
  } catch (e) { return `[SharePoint 에러]: ${e}`; }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: "⚠️ 다시 로그인 해주세요." }] }), { status: 200 });
    }

    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      // 🌟 공식 문서 권장 최신 모델명 적용
      model: "claude-sonnet-4-5-20250929", 
      max_tokens: 4096,
      system: `당신은 크래프톤 지식베이스 'Chat진피티'입니다. 
      지분율 질문 시 반드시 'search_sharepoint' 도구를 사용하여 실제 파일을 확인하십시오.`,
      messages: messages,
      tools: [
        { 
          name: "search_sharepoint", 
          description: "SharePoint 파일 검색", 
          input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } 
        }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      const toolResult = await searchSharePoint(toolCall.input.query, session.accessToken);

      const finalResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929", // 🌟 동일 모델명 적용
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
  } catch (error: any) { return new Response(JSON.stringify({ error: error.message }), { status: 500 }); }
}
