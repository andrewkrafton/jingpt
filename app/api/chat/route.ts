import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 
// @ts-ignore
import pdf from 'pdf-parse/lib/pdf-parse.js';

export const runtime = 'nodejs';
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// SharePoint 파일 검색
async function searchSharePoint(query: string, accessToken: string) {
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
          size: 15 
        }]
      }),
    });

    if (!res.ok) {
      const errorData = await res.json();
      return JSON.stringify({ error: `검색 실패 (${res.status})`, detail: errorData.error?.message });
    }

    const data = await res.json();
    const hits = data.value?.[0]?.hitsContainers?.[0]?.hits || [];

    if (hits.length === 0) {
      return JSON.stringify({ message: `"${query}" 검색 결과가 없습니다.` });
    }

    const results = hits.map((hit: any) => {
      const webUrl = hit.resource.webUrl || '';
      const name = hit.resource.name || '';
      let source = '기타';
      
      if (webUrl.includes('Financialinstruments') || webUrl.includes('투자사재무제표')) {
        source = '재무제표';
      } else if (webUrl.includes('Corp.Dev.StrategyDiv') || webUrl.includes('Contracts')) {
        source = '계약서/PMI';
      }

      let fileType = 'unknown';
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) fileType = 'excel';
      else if (name.endsWith('.pdf')) fileType = 'pdf';
      else if (name.endsWith('.docx') || name.endsWith('.doc')) fileType = 'word';

      return {
        name: name,
        webUrl: webUrl,
        driveId: hit.resource.parentReference?.driveId,
        itemId: hit.resource.id,
        lastModified: hit.resource.fileSystemInfo?.lastModifiedDateTime,
        source: source,
        fileType: fileType,
        size: hit.resource.size
      };
    });

    return JSON.stringify(results);
  } catch (error: any) {
    return JSON.stringify({ error: "검색 실패", detail: error.message });
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
    const sheets = (data.value || []).map((s: any) => s.name);
    return JSON.stringify({ sheets: sheets });
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

    if (values.length > 100) {
      content += `\n... (총 ${values.length}행 중 100행만 표시)`;
    }

    return JSON.stringify({ 
      sheetName: sheetName,
      totalRows: values.length,
      content: content
    });
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
        return JSON.stringify({ 
          error: "PDF 다운로드 실패",
          fileName: info.name,
          webUrl: info.webUrl
        });
      }
      return JSON.stringify({ error: "PDF 파일을 다운로드할 수 없습니다." });
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfData = await pdf(buffer);

    let text = pdfData.text || '';
    text = text.replace(/\s+/g, ' ').trim();
    
    const maxLength = 15000;
    const truncated = text.length > maxLength;
    if (truncated) {
      text = text.slice(0, maxLength) + '\n\n... (문서가 길어 일부만 표시됨)';
    }

    return JSON.stringify({ 
      success: true,
      numPages: pdfData.numpages,
      textLength: pdfData.text.length,
      content: text,
      truncated: truncated
    });

  } catch (error: any) {
    return JSON.stringify({ 
      error: "PDF 파싱 실패", 
      detail: error.message
    });
  }
}

// 메시지 정리
function cleanMessages(messages: any[]) {
  const cleaned: any[] = [];
  for (const msg of messages) {
    let textContent = '';
    if (typeof msg.content === 'string') {
      textContent = msg.content;
    } else if (Array.isArray(msg.content)) {
      textContent = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
    }
    if (textContent.trim()) {
      cleaned.push({ role: msg.role, content: textContent.trim() });
    }
  }
  return cleaned.slice(-6);
}

// Tool 이름을 한글 상태 메시지로 변환
function getToolStatusMessage(toolName: string, input: any): string {
  switch (toolName) {
    case 'search_sharepoint':
      return `🔍 SharePoint에서 "${input.query}" 검색 중...`;
    case 'get_excel_sheets':
      return `📊 Excel 파일 구조 분석 중...`;
    case 'read_excel_sheet':
      return `📈 "${input.sheetName}" 시트 데이터 읽는 중...`;
    case 'read_pdf_file':
      return `📄 PDF 문서 내용 분석 중...`;
    default:
      return `⏳ 처리 중...`;
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions) as any;
    
    // 세션 체크
    if (!session) {
      return new Response(JSON.stringify({ 
        error: "로그인이 필요합니다. 다시 로그인해주세요.",
        action: "relogin"
      }), { status: 401 });
    }

    // 토큰 갱신 실패 체크
    if (session.error === "RefreshAccessTokenError") {
      return new Response(JSON.stringify({ 
        error: "세션이 만료되었습니다. 로그아웃 후 다시 로그인해주세요.",
        action: "relogin"
      }), { status: 401 });
    }

    // 액세스 토큰 체크
    if (!session.accessToken) {
      return new Response(JSON.stringify({ 
        error: "인증 토큰이 없습니다. 로그아웃 후 다시 로그인해주세요.",
        action: "relogin"
      }), { status: 401 });
    }

    const { messages } = await req.json();
    const cleanedMessages = cleanMessages(messages);

    const modelId = "claude-opus-4-5-20251101"; 

    const systemPrompt = `당신은 크래프톤 포트폴리오 관리 AI 어시스턴트 "진피티"입니다.

## 핵심 역할
SharePoint에서 포트폴리오사 문서를 검색하고, **반드시 내용을 읽어서** 구체적인 답변을 제공합니다.

## 데이터 위치
1. **재무제표/Cap Table/지분율**: Financialinstruments 사이트
2. **계약서 (BCA, SHA, ROFN, 2PP 등)**: Corp.Dev.StrategyDiv > Contracts Package

## 사용 가능한 도구
1. **search_sharepoint**: 파일 검색
2. **get_excel_sheets**: Excel 시트 목록 조회
3. **read_excel_sheet**: Excel 특정 시트 읽기
4. **read_pdf_file**: PDF 파일 내용 읽기

## 포트폴리오사 별칭
- Ruckus Games Holdings, Inc. = Ruckus
- Antistatic Studios Inc. = Antistatic
- Day 4 Night = D4N
- Gardens Interactive = Gardens
- People Can Fly = PCF
- Unknown Worlds = UW

## 답변 형식 (중요!)

### 출처 표시 규칙
답변 마지막에 반드시 출처를 아래 형식으로 표시하세요:

---
**📁 출처**
- [파일명.pdf](SharePoint URL) - 최종 수정일: YYYY-MM-DD
- [파일명.xlsx](SharePoint URL) - 최종 수정일: YYYY-MM-DD

### 예시:
---
**📁 출처**
- [Ruckus Games - BCA.pdf](https://blueholestudio.sharepoint.com/sites/Corp.Dev.StrategyDiv/...) - 최종 수정일: 2025-06-15
- [Ruckus_CapTable.xlsx](https://blueholestudio.sharepoint.com/sites/Financialinstruments/...) - 최종 수정일: 2025-12-31

## 답변 원칙
1. PDF, Excel 모두 직접 읽어서 구체적인 내용 제공
2. 조항 내용, 숫자, 조건을 답변에 포함
3. **출처는 반드시 클릭 가능한 마크다운 링크로 제공**
4. 한국어로 친절하고 상세하게 답변`;

    const tools = [
      {
        name: "search_sharepoint",
        description: "SharePoint에서 파일을 검색합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "검색어" }
          },
          required: ["query"]
        }
      },
      {
        name: "get_excel_sheets",
        description: "Excel 파일의 시트 목록을 조회합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string" },
            itemId: { type: "string" }
          },
          required: ["driveId", "itemId"]
        }
      },
      {
        name: "read_excel_sheet",
        description: "Excel 파일의 특정 시트 내용을 읽습니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string" },
            itemId: { type: "string" },
            sheetName: { type: "string" }
          },
          required: ["driveId", "itemId", "sheetName"]
        }
      },
      {
        name: "read_pdf_file",
        description: "PDF 파일의 텍스트 내용을 읽습니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string" },
            itemId: { type: "string" }
          },
          required: ["driveId", "itemId"]
        }
      }
    ];

    // 스트리밍 응답 설정
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendStatus = async (status: string) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: status })}\n\n`));
    };

    const sendFinal = async (content: any) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify({ type: 'final', content: content })}\n\n`));
      await writer.close();
    };

    (async () => {
      try {
        await sendStatus('🤔 질문 분석 중...');

        let currentMessages = [...cleanedMessages];
        let response = await anthropic.messages.create({
          model: modelId,
          max_tokens: 8192,
          system: systemPrompt,
          messages: currentMessages,
          tools: tools
        });

        let loopCount = 0;
        while (response.stop_reason === 'tool_use' && loopCount < 10) {
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

            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: result
            });
          }

          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: response.content },
            { role: 'user', content: toolResults }
          ];

          await sendStatus('✨ 답변 생성 중...');

          response = await anthropic.messages.create({
            model: modelId,
            max_tokens: 8192,
            system: systemPrompt,
            messages: currentMessages,
            tools: tools
          });
        }

        await sendFinal(response.content);

      } catch (error: any) {
        console.error("에러:", error.message);
        await sendFinal([{ type: 'text', text: '⚠️ 오류가 발생했습니다. 다시 시도해주세요.' }]);
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error("에러:", error.message);
    return new Response(JSON.stringify({ 
      error: "오류가 발생했습니다." 
    }), { status: 500 });
  }
}
