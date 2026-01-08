// app/api/chat/route.ts
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// 💡 Andrew님의 실제 권한으로 SharePoint를 검색합니다.
async function searchSharePoint(query: string, accessToken: string) {
  try {
    const searchRes = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`, // Andrew님의 통행증
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        requests: [{
          entityTypes: ['driveItem'],
          query: { queryString: query },
          from: 0,
          size: 10 // 💡 Claude.ai처럼 10개까지 가져옵니다.
        }]
      }),
    });
    const data = await searchRes.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return `[결과 없음] '${query}' 관련 파일을 찾지 못했습니다.`;
    
    // 💡 파일명과 웹 주소를 함께 전달하여 AI가 출처를 적을 수 있게 합니다.
    return JSON.stringify(hits.map((h: any) => ({
      name: h.resource.name,
      webUrl: h.resource.webUrl,
      lastModified: h.resource.lastModifiedDateTime
    })));
  } catch (e) { return `[에러] SharePoint 접근 실패: ${e}`; }
}

export async function POST(req: Request) {
  try {
    // 💡 로그인 세션에서 Andrew님의 토큰을 가져옵니다.
    const session = await getServerSession(authOptions) as any;
    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ error: "인증 토큰이 없습니다. 다시 로그인해주세요." }), { status: 401 });
    }

    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 
      사용자의 질문을 받으면 반드시 'search_sharepoint' 도구를 먼저 사용하여 실제 파일을 확인하십시오. 
      절대 추측하여 답변하지 마십시오.`,
      messages: messages,
      tools: [
        { name: "search_sharepoint", description: "SharePoint 파일 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { name: "search_confluence", description: "위키 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      let toolResult = "";

      if (toolCall.name === 'search_sharepoint') {
        // 💡 Andrew님의 토큰을 들고 검색하러 갑니다.
        toolResult = await searchSharePoint(toolCall.input.query, session.accessToken);
      } else {
        // Confluence 로직 (생략)
      }

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
  } catch (error: any) { return new Response(JSON.stringify({ error: error.message }), { status: 500 }); }
}
