import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

async function searchSharePoint(query: string, accessToken: string) {
  console.log("=== SharePoint 검색 시작 ===");
  console.log("검색어:", query);
  console.log("토큰 존재:", !!accessToken);
  console.log("토큰 길이:", accessToken?.length || 0);
  console.log("토큰 앞 50자:", accessToken?.slice(0, 50));

  if (!accessToken) {
    console.log("에러: 토큰이 없음");
    return JSON.stringify({ error: "인증 토큰이 없습니다. 다시 로그인해주세요." });
  }

  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        requests: [{ 
          entityTypes: ['driveItem'], 
          query: { queryString: query }, 
          from: 0, 
          size: 10 
        }]
      }),
    });

    console.log("SharePoint 응답 상태:", res.status);
    console.log("SharePoint 응답 OK:", res.ok);

    const data = await res.json();
    console.log("SharePoint 응답 데이터:", JSON.stringify(data).slice(0, 500));

    if (!res.ok) {
      console.log("SharePoint API 에러:", data);
      return JSON.stringify({ 
        error: `SharePoint API 에러 (${res.status})`, 
        detail: data.error?.message || data 
      });
    }

    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    
    if (!hits || hits.length === 0) {
      return JSON.stringify({ message: "검색 결과가 없습니다.", query });
    }

    return JSON.stringify(hits.map((h: any) => ({ 
      name: h.resource.name, 
      id: h.resource.id, 
      webUrl: h.resource.webUrl 
    })));

  } catch (error: any) {
    console.log("SharePoint 호출 중 예외 발생:", error.message);
    return JSON.stringify({ error: "SharePoint 연결 실패", detail: error.message });
  }
}

export async function POST(req: Request) {
  console.log("=== API 요청 시작 ===");
  
  try {
    const session = await getServerSession(authOptions) as any;
    
    console.log("세션 존재:", !!session);
    console.log("세션 사용자:", session?.user?.email);
    console.log("accessToken 존재:", !!session?.accessToken);
    console.log("accessToken 타입:", typeof session?.accessToken);

    if (!session) {
      console.log("에러: 세션 없음");
      return new Response(JSON.stringify({ 
        error: "로그인이 필요합니다.",
        needsAuth: true 
      }), { status: 401 });
    }

    if (!session.accessToken) {
      console.log("에러: accessToken 없음");
      return new Response(JSON.stringify({ 
        error: "Microsoft 인증 토큰이 없습니다. 로그아웃 후 다시 로그인해주세요.",
        needsReauth: true 
      }), { status: 401 });
    }

    const { messages } = await req.json();
    console.log("메시지 수신:", messages?.length, "개");

    const modelId = "claude-sonnet-4-5-20250929"; 

    console.log("Claude API 첫 번째 호출 시작");
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: "당신은 크래프톤 포트폴리오 관리 AI 어시스턴트입니다. SharePoint에서 파일을 검색할 때 search_sharepoint 도구를 사용하세요. 검색 결과를 바탕으로 정확하게 답변하고, 데이터가 없으면 없다고 솔직하게 말하세요.",
      messages,
      tools: [{
        name: "search_sharepoint",
        description: "SharePoint에서 파일을 검색합니다. Cap Table, 계약서, 재무제표 등을 찾을 때 사용합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "검색할 키워드 (예: 'Ruckus Games Cap Table', 'EF Games 계약서')"
            }
          },
          required: ["query"]
        }
      }]
    });

    console.log("Claude 첫 번째 응답 stop_reason:", response.stop_reason);

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      console.log("Tool 호출 감지:", toolCall?.name);
      console.log("Tool 입력:", JSON.stringify(toolCall?.input));

      const toolResult = await searchSharePoint(toolCall.input.query, session.accessToken);
      console.log("Tool 결과 길이:", toolResult.length);

      console.log("Claude API 두 번째 호출 시작");
      const finalResponse = await anthropic.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: "당신은 크래프톤 포트폴리오 관리 AI 어시스턴트입니다. 검색 결과를 바탕으로 사용자에게 유용한 정보를 제공하세요.",
        messages: [
          ...messages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResult }] }
        ]
      });

      console.log("Claude 두 번째 응답 완료");
      return new Response(JSON.stringify({ content: finalResponse.content }));
    }

    console.log("Tool 호출 없이 직접 응답");
    return new Response(JSON.stringify({ content: response.content }));

  } catch (error: any) {
    console.error("=== API 에러 발생 ===");
    console.error("에러 메시지:", error.message);
    console.error("에러 스택:", error.stack);
    
    return new Response(JSON.stringify({ 
      error: "처리 중 오류가 발생했습니다.",
      detail: error.message 
    }), { status: 500 });
  }
}
