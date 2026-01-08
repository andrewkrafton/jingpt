import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; // 빌드 에러 방지를 위한 상대 경로

export const runtime = 'nodejs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// 1. SharePoint 파일 검색 함수
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
          size: 10 // 검색 결과 10개까지 확대
        }]
      }),
    });
    const data = await res.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits;
    if (!hits || hits.length === 0) return `[검색 결과 없음] SharePoint에서 '${query}' 관련 파일을 찾지 못했습니다.`;
    
    // 파일명, ID, 웹 URL을 함께 반환하여 모델이 다음 행동을 결정하게 함
    return JSON.stringify(hits.map((h: any) => ({
      name: h.resource.name,
      id: h.resource.id,
      webUrl: h.resource.webUrl,
      path: h.resource.parentReference?.path
    })));
  } catch (e) {
    return `[SharePoint 접근 에러]: ${e}`;
  }
}

// 2. SharePoint 특정 파일 상세 정보/메타데이터 읽기
async function readSharePointFile(fileId: string, accessToken: string) {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await res.json();
    // 엑셀 등은 직접 읽기가 복잡하므로 메타데이터와 파일 정보를 최대한 제공
    return JSON.stringify({
      name: data.name,
      size: data.size,
      lastModified: data.lastModifiedDateTime,
      description: data.description || "설명 없음",
      webUrl: data.webUrl
    });
  } catch (e) {
    return `[파일 읽기 실패]: ${e}`;
  }
}

// 3. Confluence 검색 함수
async function searchConfluence(query: string) {
  const domain = process.env.ATLASSIAN_DOMAIN;
  const email = process.env.ATLASSIAN_EMAIL;
  const token = process.env.ATLASSIAN_TOKEN;
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  try {
    const res = await fetch(`https://${domain}/wiki/rest/api/content/search?cql=text~"${query}"&limit=5`,
      { headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' } });
    const data = await res.json();
    if (!data.results || data.results.length === 0) return `[검색 결과 없음] Confluence에서 '${query}' 관련 내용을 찾지 못했습니다.`;
    return data.results.map((r: any) => `[제목: ${r.title}] (URL: https://${domain}/wiki${r._links.webui})`).join('\n');
  } catch (e) { return "Confluence 접근 실패"; }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    
    // 세션이 없거나 토큰이 없는 경우 대응
    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ 
        content: [{ type: 'text', text: "⚠️ 인증 정보가 없습니다. 오른쪽 상단에서 로그아웃 후 다시 로그인하여 'SharePoint 접근 권한'을 승인해 주세요." }] 
      }), { status: 200 });
    }

    const { messages } = await req.json();

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20240620", // 🌟 Claude 3.5 Sonnet으로 업그레이드
      max_tokens: 4096,
      system: `당신은 크래프톤 전용 지식 서비스 'Chat진피티'입니다.
      
      **작동 지침**:
      1. 지분율, 계약 조건(ROFN, 2PP 등), 재무 수치 질문을 받으면 반드시 'search_sharepoint' 도구를 먼저 사용하십시오.
      2. 2PP는 '2nd Party Publishing'의 약자입니다. 절대 '2분기'로 해석하지 마십시오.
      3. 검색 결과에 파일 목록이 나오면, 가장 관련 있는 파일의 ID를 사용해 'read_sharepoint_file'을 호출하거나 사용자에게 해당 파일 링크를 안내하십시오.
      4. **절대 거짓말하지 마십시오.** 파일 내부를 직접 읽지 못했다면 추측으로 숫자를 지어내지 말고 "파일은 찾았으나 상세 내용을 확인하려면 링크를 참조하십시오"라고 정직하게 답하십시오.`,
      messages: messages,
      tools: [
        { 
          name: "search_sharepoint", 
          description: "SharePoint에서 파일 이름 및 내용 검색", 
          input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } 
        },
        { 
          name: "read_sharepoint_file", 
          description: "특정 파일의 상세 메타데이터 및 정보 읽기", 
          input_schema: { type: "object", properties: { fileId: { type: "string" } }, required: ["fileId"] } 
        },
        { 
          name: "search_confluence", 
          description: "컨플루언스 위키 페이지 검색", 
          input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } 
        }
      ]
    });

    // 도구 사용 처리 (Tool Use Loop)
    if (response.stop_reason === 'tool_use') {
      const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
      let toolResult = "";

      if (toolCall.name === 'search_sharepoint') {
        toolResult = await searchSharePoint(toolCall.input.query, session.accessToken);
      } else if (toolCall.name === 'read_sharepoint_file') {
        toolResult = await readSharePointFile(toolCall.input.fileId, session.accessToken);
      } else {
        toolResult = await searchConfluence(toolCall.input.query);
      }

      const finalResponse = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
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
