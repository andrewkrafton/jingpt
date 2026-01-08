import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// SharePoint 검색 함수
async function searchSharePoint(query: string, accessToken: string) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ 
          entityTypes: ['driveItem'], 
          query: { queryString: query }, 
          from: 0, 
          size: 10 
        }]
      }),
    });
    const data = await res.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return `[검색 결과 없음] SharePoint에서 '${query}' 관련 파일을 찾지 못했습니다.`;
    
    return JSON.stringify(hits.map((h: any) => ({
      name: h.resource.name,
      id: h.resource.id,
      webUrl: h.resource.webUrl
    })));
  } catch (e) {
    return `[SharePoint 접근 에러]: ${e}`;
  }
}

// 파일 상세 읽기 함수
async function readSharePointFile(fileId: string, accessToken: string) {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    return JSON.stringify({
      name: data.name,
      webUrl: data.webUrl,
      description: data.description || "상세 설명 없음"
    });
  } catch (e) {
    return `[파일 읽기 실패]: ${e}`;
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    
    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ 
        content: [{ type: 'text', text: "⚠️ 인증 정보가 없습니다. 다시 로그인 해주세요." }] 
      }), { status: 200 });
    }

    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      // 🌟 지인이 추천한 모델명으로 수정
      model: "claude-sonnet-4-5", 
      max_tokens: 4096,
      system: `당신은 크래프톤 전용 지식 서비스 'Chat진피티'입니다. 
      사용자의 질문에 대해 반드시 'search_sharepoint' 도구를 사용하여 실제 파일을 확인하십시오. 
      추측으로 답변하지 마십시오.`,
      messages: messages,
      tools: [
        { 
          name: "search_sharepoint", 
          description: "SharePoint 파일 검색", 
          input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } 
        },
        { 
          name: "read_sharepoint_file", 
          description: "파일 상세 정보 읽기", 
          input_schema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] } 
        }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      let toolResult = "";

      if (toolCall.name === 'search_sharepoint') {
        toolResult = await searchSharePoint(toolCall.input.query, session.accessToken);
      } else {
        toolResult = await readSharePointFile(toolCall.input.fileId, session.accessToken);
      }

      const finalResponse = await anthropic.messages.create({
        // 🌟 지인이 추천한 모델명으로 수정
        model: "claude-sonnet-4-5", 
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
