import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// 1. SharePoint 파일 검색 (Claude의 Search와 동일)
async function searchSharePoint(query: string, accessToken: string) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ entityTypes: ['driveItem'], query: { queryString: query }, from: 0, size: 5 }]
      }),
    });
    const data = await res.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return "SharePoint에서 파일을 찾지 못했습니다. 권한이 부족하거나 파일이 없습니다.";
    return JSON.stringify(hits.map((h: any) => ({ name: h.resource.name, id: h.resource.id, webUrl: h.resource.webUrl })));
  } catch (e) { return "인증 토큰이 만료되었거나 접근이 거부되었습니다. 로그아웃 후 다시 로그인하세요."; }
}

// 2. 🌟 핵심: 파일 내용 읽기 (Claude의 Read Resource와 동일)
async function readSharePointFile(fileId: string, accessToken: string) {
  try {
    // 엑셀이나 문서는 텍스트로 바로 읽기 어려우므로 메타데이터와 미리보기 정보를 가져옵니다.
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    return `파일명: ${data.name}, 요약: ${data.description || '내용 요약 없음'}. (주의: 현재 버전은 파일명과 메타데이터만 추출 가능합니다. 상세 지분율은 파일의 webUrl을 참조하세요.)`;
  } catch (e) { return "파일 내용을 읽는 데 실패했습니다."; }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    // 💡 인증 토큰이 없으면 AI가 답변 대신 "인증 필요" 메시지를 던지게 합니다.
    if (!session?.accessToken) {
      return new Response(JSON.stringify({ 
        content: [{ type: 'text', text: "⚠️ 데이터에 접근하려면 Microsoft 365 인증이 필요합니다. 오른쪽 상단의 로그아웃 후 다시 로그인하여 '모든 파일 읽기' 권한을 승인해주세요." }] 
      }), { status: 200 });
    }

    const { messages } = await req.json();
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 4096,
      system: `당신은 'Chat진피티'입니다. 
      사용자가 질문하면 1. 먼저 파일을 검색하고(search_sharepoint), 2. 관련 파일의 ID를 얻으면 내용을 확인(read_sharepoint_file)하십시오. 
      절대 눈에 보이지 않는 데이터를 있다고 속이지 마십시오.`,
      messages: messages,
      tools: [
        { name: "search_sharepoint", description: "파일 이름으로 검색", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
        { name: "read_sharepoint_file", description: "특정 파일의 상세 정보 읽기", input_schema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] } }
      ]
    });

    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      const toolResult = toolCall.name === 'search_sharepoint' 
        ? await searchSharePoint(toolCall.input.query, session.accessToken)
        : await readSharePointFile(toolCall.input.fileId, session.accessToken);

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
