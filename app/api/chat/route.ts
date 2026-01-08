import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// --- 1. SharePoint 검색 (Andrew님의 권한 대행) ---
async function searchSharePoint(query: string, accessToken: string) {
  try {
    const searchRes = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${accessToken}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        requests: [{
          entityTypes: ['driveItem'],
          query: { queryString: `"${query}"` }
        }]
      }),
    });
    const data = await searchRes.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return `[결과 없음] '${query}'에 대한 파일을 찾지 못했습니다.`;
    return JSON.stringify(hits.map((h: any) => h.resource.name));
  } catch (e) {
    return `[에러] SharePoint 접근 실패: ${e}`;
  }
}

// --- 2. Confluence 검색 ---
async function searchConfluence(query: string) {
  const domain = process.env.ATLASSIAN_DOMAIN;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  try {
    const res = await fetch(`https://${domain}/wiki/rest/api/content/search?cql=text~"${query}"&limit=5`,
      { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } });
    const data = await res.json();
    if (!data.results || data.results.length === 0) return `[결과 없음] '${query}' 관련 위키를 찾지 못했습니다.`;
    return data.results.map((r: any) => `[제목: ${r.title}] (URL: https://${domain}/wiki${r._links.webui})`).join('\n');
  } catch (e) { return "Confluence 접근 실패"; }
}

export async function POST(req: Request) {
  try {
    // 💡 현재 로그인한 사용자의 세션(토큰 포함)을 가져옵니다.
    const session = await getServerSession(authOptions) as any;
    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다.
      - 규칙 1: 절대 추측하지 마세요. 반드시 검색 도구를 사용하세요.
      - 규칙 2: 2PP는 '2nd Party Publishing'의 약자입니다. 절대 '2분기'로 해석하지 마세요.
      - 규칙 3: 검색 결과가 없으면 "검색에 실패했습니다"라고 정직하게 말하세요.`,
      messages: messages,
      tools: [
        { name: "search_confluence", description: "위키 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { name: "search_sharepoint", description: "파일 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      let toolResult = "";

      if (toolCall.name === 'search_confluence') {
        toolResult = await searchConfluence(toolCall.input.query);
      } else {
        // 💡 Andrew님의 실제 액세스 토큰을 검색 함수에 전달합니다.
        toolResult = await searchSharePoint(toolCall.input.query, session?.accessToken || "");
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
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
