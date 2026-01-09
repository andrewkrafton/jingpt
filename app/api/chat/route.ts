import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 
import { cookies } from 'next/headers';
// @ts-ignore
import pdf from 'pdf-parse/lib/pdf-parse.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// 허용된 SharePoint 폴더 경로
const ALLOWED_PATHS = {
  financial: ['Financialinstruments', '투자사재무제표', 'Accounting Team'],
  contracts: ['Corp.Dev.StrategyDiv', 'Contracts package', 'Contracts Package']
};

function isAllowedPath(webUrl: string): { allowed: boolean; category: string } {
  const url = webUrl.toLowerCase();
  for (const path of ALLOWED_PATHS.financial) {
    if (url.includes(path.toLowerCase())) return { allowed: true, category: '재무제표/Cap Table' };
  }
  for (const path of ALLOWED_PATHS.contracts) {
    if (url.includes(path.toLowerCase())) return { allowed: true, category: '계약서/PMI' };
  }
  return { allowed: false, category: '기타' };
}

// SharePoint 파일 검색
async function searchSharePoint(query: string, accessToken: string) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/search/query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ entityTypes: ['driveItem'], query: { queryString: query }, from: 0, size: 25 }]
      }),
    });

    if (!res.ok) {
      const errorData = await res.json();
      return JSON.stringify({ error: `검색 실패 (${res.status})`, detail: errorData.error?.message });
    }

    const data = await res.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits || [];

    if (hits.length === 0) return JSON.stringify({ message: `"${query}" 검색 결과가 없습니다.` });

    const filteredResults = hits
      .map((hit: any) => {
        const webUrl = hit.resource.webUrl || '';
        const name = hit.resource.name || '';
        const pathCheck = isAllowedPath(webUrl);
        if (!pathCheck.allowed) return null;

        let fileType = 'unknown';
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) fileType = 'excel';
        else if (name.endsWith('.pdf')) fileType = 'pdf';
        else if (name.endsWith('.docx') || name.endsWith('.doc')) fileType = 'word';

        const encodedUrl = webUrl.split('/').map((part: string, index: number) => {
          if (index < 3) return part;
          return encodeURIComponent(part);
        }).join('/');

        return {
          name, webUrl: encodedUrl, driveId: hit.resource.parentReference?.driveId,
          itemId: hit.resource.id, lastModified: hit.resource.fileSystemInfo?.lastModifiedDateTime,
          source: pathCheck.category, fileType, size: hit.resource.size
        };
      })
      .filter((item: any) => item !== null);

    if (filteredResults.length === 0) {
      return JSON.stringify({ message: `"${query}" 검색 결과가 지정된 폴더에 없습니다.` });
    }
    return JSON.stringify(filteredResults);
  } catch (error: any) {
    return JSON.stringify({ error: "검색 실패", detail: error.message });
  }
}

// Confluence Cloud ID 가져오기
async function getConfluenceCloudId(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    });
    
    if (!res.ok) return null;
    
    const sites = await res.json();
    const kraftonSite = sites.find((s: any) => s.url.includes('krafton')) || sites[0];
    return kraftonSite?.id || null;
  } catch (error) {
    console.error("Cloud ID 조회 실패:", error);
    return null;
  }
}

// Confluence 검색 (본문 포함, 최적화)
async function searchConfluence(query: string, accessToken: string) {
  try {
    console.log('=== Confluence Search ===');
    console.log('Query:', query);
    
    const cloudId = await getConfluenceCloudId(accessToken);
    if (!cloudId) {
      return JSON.stringify({ error: "Confluence 연결 실패. 다시 로그인해주세요." });
    }

    // 검색 결과 5개로 제한 (토큰 절약)
    const cql = encodeURIComponent(`text ~ "${query}" OR title ~ "${query}"`);
    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/search?cql=${cql}&limit=5&expand=body.storage,space,version`;
    
    const res = await fetch(url, { 
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } 
    });

    console.log('Search status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Search error:', errorText);
      return JSON.stringify({ error: "Confluence 검색 실패" });
    }

    const data = await res.json();
    console.log('Results count:', data.results?.length || 0);
    
    const results = (data.results || []).map((page: any) => {
      // HTML에서 텍스트 추출
      let content = page.body?.storage?.value || '';
      content = content
        .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
      
      // 본문 1500자로 제한 (토큰 절약)
      if (content.length > 1500) {
        content = content.slice(0, 1500) + '...';
      }

      return {
        id: page.id,
        title: page.title,
        space: page.space?.name || '',
        url: `https://krafton.atlassian.net/wiki${page._links?.webui || ''}`,
        content: content
      };
    });

    if (results.length === 0) {
      return JSON.stringify({ message: `"${query}" 검색 결과가 없습니다.` });
    }
    return JSON.stringify(results);
  } catch (error: any) {
    console.error('Confluence search error:', error);
    return JSON.stringify({ error: "Confluence 검색 실패", detail: error.message });
  }
}

// Confluence 페이지 읽기
async function readConfluencePage(pageId: string, accessToken: string) {
  try {
    console.log('=== Reading Confluence Page ===');
    
    const cloudId = await getConfluenceCloudId(accessToken);
    if (!cloudId) {
      return JSON.stringify({ error: "Confluence 연결 실패" });
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/${pageId}?expand=body.view,space,version`;
    
    const res = await fetch(url, { 
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } 
    });

    if (!res.ok) {
      return JSON.stringify({ 
        error: "페이지 읽기 실패. search_confluence로 제목 검색을 시도해주세요.",
        pageId: pageId
      });
    }

    const page = await res.json();
    
    let content = page.body?.view?.value || page.body?.storage?.value || '';
    content = content
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (content.length > 8000) {
      content = content.slice(0, 8000) + '\n\n... (문서가 길어 일부만 표시됨)';
    }

    return JSON.stringify({
      title: page.title,
      space: page.space?.name,
      url: `https://krafton.atlassian.net/wiki${page._links?.webui || ''}`,
      content: content
    });
  } catch (error: any) {
    return JSON.stringify({ error: "페이지 읽기 실패", detail: error.message });
  }
}

// Excel 시트 목록 조회
async function getExcelSheets(driveId: string, itemId: string, accessToken: string) {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const error = await res.json();
      return JSON.stringify({ error: "시트 목록 조회 실패", detail: error.error?.message });
    }
    const data = await res.json();
    return JSON.stringify({ sheets: (data.value || []).map((s: any) => s.name) });
  } catch (error: any) {
    return JSON.stringify({ error: "시트 목록 조회 실패", detail: error.message });
  }
}

// Excel 특정 시트 읽기
async function readExcelSheet(driveId: string, itemId: string, sheetName: string, accessToken: string) {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')/usedRange`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const error = await res.json();
      return JSON.stringify({ error: "시트 읽기 실패", detail: error.error?.message });
    }
    const data = await res.json();
    const values = data.values || [];
    const maxRows = Math.min(values.length, 100);
    let content = '';
    for (let i = 0; i < maxRows; i++) {
      const row = values[i];
      if (row && row.some((cell: any) => cell !== null && cell !== '')) {
        content += row.map((cell: any) => cell ?? '').join(' | ') + '\n';
      }
    }
    if (values.length > 100) content += `\n... (총 ${values.length}행 중 100행만 표시)`;
    return JSON.stringify({ sheetName, totalRows: values.length, content });
  } catch (error: any) {
    return JSON.stringify({ error: "시트 읽기 실패", detail: error.message });
  }
}

// PDF 파일 읽기
async function readPdfFile(driveId: string, itemId: string, accessToken: string) {
  try {
    const downloadRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!downloadRes.ok) {
      const infoRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } }
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        return JSON.stringify({ error: "PDF 다운로드 실패", fileName: info.name, webUrl: info.webUrl });
      }
      return JSON.stringify({ error: "PDF 파일을 다운로드할 수 없습니다." });
    }
    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfData = await pdf(buffer);
    let text = (pdfData.text || '').replace(/\s+/g, ' ').trim();
    const truncated = text.length > 15000;
    if (truncated) text = text.slice(0, 15000) + '\n\n... (문서가 길어 일부만 표시됨)';
    return JSON.stringify({ success: true, numPages: pdfData.numpages, content: text, truncated });
  } catch (error: any) {
    return JSON.stringify({ error: "PDF 파싱 실패", detail: error.message });
  }
}

// 메시지 정리
function cleanMessages(messages: any[]) {
  const cleaned: any[] = [];
  for (const msg of messages) {
    let textContent = '';
    if (typeof msg.content === 'string') textContent = msg.content;
    else if (Array.isArray(msg.content)) {
      textContent = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    }
    if (textContent.trim()) cleaned.push({ role: msg.role, content: textContent.trim() });
  }
  return cleaned.slice(-4); // 최근 4개만 (토큰 절약)
}

// Tool 상태 메시지
function getToolStatusMessage(toolName: string, input: any): string {
  switch (toolName) {
    case 'search_sharepoint': return `🔍 SharePoint에서 "${input.query}" 검색 중...`;
    case 'search_confluence': return `📚 Confluence에서 "${input.query}" 검색 중...`;
    case 'read_confluence_page': return `📖 Confluence 문서 읽는 중...`;
    case 'get_excel_sheets': return `📊 Excel 파일 구조 분석 중...`;
    case 'read_excel_sheet': return `📈 "${input.sheetName}" 시트 읽는 중...`;
    case 'read_pdf_file': return `📄 PDF 문서 분석 중...`;
    default: return `⏳ 처리 중...`;
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    
    if (!session) {
      return new Response(JSON.stringify({ error: "로그인이 필요합니다." }), { status: 401 });
    }
    if (session.error === "RefreshAccessTokenError") {
      return new Response(JSON.stringify({ error: "세션이 만료되었습니다. 다시 로그인해주세요." }), { status: 401 });
    }
    if (!session.accessToken) {
      return new Response(JSON.stringify({ error: "SharePoint 인증이 필요합니다." }), { status: 401 });
    }

    const cookieStore = cookies();
    const atlassianToken = cookieStore.get('atlassian_access_token')?.value;
    const hasConfluence = !!atlassianToken;

    const { messages } = await req.json();
    const cleanedMessages = cleanMessages(messages);
    const modelId = "claude-sonnet-4-20250514"; // Sonnet으로 변경 (더 빠름)

    const systemPrompt = `당신은 크래프톤 포트폴리오 관리 AI 어시스턴트 "진피티"입니다.

## 핵심 원칙
1. **한 번의 검색으로 최대한 정보 추출** - 검색 결과의 content에 필요한 정보가 있으면 바로 답변
2. **반복 검색 금지** - 같은 주제로 여러 번 검색하지 말 것
3. **즉시 답변** - 정보를 찾으면 바로 정리해서 답변

## 데이터 소스
- **SharePoint**: 재무제표, Cap Table, 계약서
- **Confluence**: 포트폴리오사 위키, 2PP/ROFN 정보, D&O 보험

## 포트폴리오사 별칭
Ruckus Games=Ruckus, People Can Fly=PCF, Unknown Worlds=UW, Day 4 Night=D4N, 
Wolf Haus Games=WHG, The Architects Republic SAS=Arkrep, Gardens Interactive=Gardens

## 검색 팁
- 회사 정보: "[회사명]" 또는 "[회사명] 투자"로 검색
- 2PP/ROFN: "2PP Details" 검색
- 지분율: SharePoint에서 "[회사명] Cap Table" 검색

## 답변 형식
- 검색 결과에서 핵심 정보만 추출하여 표로 정리
- 출처 링크 포함
- 한국어로 친절하게`;

    const tools: any[] = [
      {
        name: "search_sharepoint",
        description: "SharePoint 파일 검색",
        input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
      },
      {
        name: "get_excel_sheets",
        description: "Excel 시트 목록",
        input_schema: { type: "object", properties: { driveId: { type: "string" }, itemId: { type: "string" } }, required: ["driveId", "itemId"] }
      },
      {
        name: "read_excel_sheet",
        description: "Excel 시트 읽기",
        input_schema: { type: "object", properties: { driveId: { type: "string" }, itemId: { type: "string" }, sheetName: { type: "string" } }, required: ["driveId", "itemId", "sheetName"] }
      },
      {
        name: "read_pdf_file",
        description: "PDF 파일 읽기",
        input_schema: { type: "object", properties: { driveId: { type: "string" }, itemId: { type: "string" } }, required: ["driveId", "itemId"] }
      }
    ];

    if (hasConfluence) {
      tools.push({
        name: "search_confluence",
        description: "Confluence 검색. 결과에 페이지 본문(content)이 포함되어 있으니 추가 검색 없이 바로 활용할 것.",
        input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
      });
      tools.push({
        name: "read_confluence_page",
        description: "특정 페이지 읽기 (pageId 필요)",
        input_schema: { type: "object", properties: { pageId: { type: "string" } }, required: ["pageId"] }
      });
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendStatus = async (status: string) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: status })}\n\n`));
    };
    const sendFinal = async (content: any) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'final', content })}\n\n`));
      await writer.close();
    };

    (async () => {
      try {
        await sendStatus('🤔 질문 분석 중...');

        let currentMessages = [...cleanedMessages];
        let response = await anthropic.messages.create({
          model: modelId, max_tokens: 4096, system: systemPrompt, messages: currentMessages, tools
        });

        let loopCount = 0;
        while (response.stop_reason === 'tool_use' && loopCount < 8) {
          loopCount++;
          const toolCalls = response.content.filter((c: any) => c.type === 'tool_use');
          const toolResults: any[] = [];

          for (const toolCall of toolCalls) {
            const tc = toolCall as any;
            await sendStatus(getToolStatusMessage(tc.name, tc.input));

            let result = '';
            switch (tc.name) {
              case 'search_sharepoint':
                result = await searchSharePoint(tc.input.query, session.accessToken);
                break;
              case 'search_confluence':
                result = await searchConfluence(tc.input.query, atlassianToken!);
                break;
              case 'read_confluence_page':
                result = await readConfluencePage(tc.input.pageId, atlassianToken!);
                break;
              case 'get_excel_sheets':
                result = await getExcelSheets(tc.input.driveId, tc.input.itemId, session.accessToken);
                break;
              case 'read_excel_sheet':
                result = await readExcelSheet(tc.input.driveId, tc.input.itemId, tc.input.sheetName, session.accessToken);
                break;
              case 'read_pdf_file':
                result = await readPdfFile(tc.input.driveId, tc.input.itemId, session.accessToken);
                break;
              default:
                result = JSON.stringify({ error: "알 수 없는 도구" });
            }

            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: toolResults }
          ];

          await sendStatus('✨ 답변 생성 중...');
          response = await anthropic.messages.create({
            model: modelId, max_tokens: 4096, system: systemPrompt, messages: currentMessages, tools
          });
        }

        await sendFinal(response.content);
      } catch (error: any) {
        console.error("에러:", error.message);
        await sendFinal([{ type: 'text', text: '⚠️ 오류가 발생했습니다. 다시 시도해주세요.' }]);
      }
    })();

    return new Response(stream.readable, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });

  } catch (error: any) {
    console.error("에러:", error.message);
    return new Response(JSON.stringify({ error: "오류가 발생했습니다." }), { status: 500 });
  }
}
