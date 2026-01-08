import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

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
    if (data.error) throw new Error(`SharePoint API: ${data.error.message}`);
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return `[결과 없음] '${query}' 관련 파일을 찾지 못했습니다.`;
    return JSON.stringify(hits.map((h: any) => ({ name: h.resource.name, id: h.resource.id, webUrl: h.resource.webUrl })));
  } catch (e: any) {
    return `[SharePoint 에러]: ${e.message}`;
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ content: [{ type: 'text', text: "⚠️ 인증 정보가 없습니다. 로그아웃 후 다시 로그인해주세요." }] }), { status: 200 });
    }

    const { messages } = await req.json();

    // 🌟 2026년 기준 공식 모델 ID 적용
    const modelId = "claude-sonnet-4-5-20250929"; 

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: "당신은 크래프톤 지식베이스 'Chat진피티'입니다. 반드시 도구를 사용하여 검색하고 거짓말하지 마세요.",
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
        model: modelId,
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
    // 💡 에러 발생 시 상세 내용을 채팅창에 텍스트로 반환합니다.
    console.error("Chat API Error:", error);
    return new Response(JSON.stringify({ 
      content: [{ type: 'text', text: `❌ 에러 발생: ${error.message}` }] 
    }), { status: 200 }); // 500 대신 200으로 보내서 내용을 확인합니다.
  }
}
