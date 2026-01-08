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
  console.log("=== SharePoint 검색 ===");
  console.log("검색어:", query);

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
    
    console.log("검색 결과 수:", hits.length);

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
  console.log("=== Excel 시트 목록 조회 ===");

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
    
    console.log("시트 목록:", sheets);
    return JSON.stringify({ sheets: sheets });
  } catch (error: any) {
    return JSON.stringify({ error: "시트 목록 조회 실패", detail: error.message });
  }
}

// Excel 특정 시트 읽기
async function readExcelSheet(driveId: string, itemId: string, sheetName: string, accessToken: string) {
  console.log("=== Excel 시트 읽기 ===");
  console.log("시트명:", sheetName);

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
    
    console.log("읽은 행 수:", values.length);

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

// PDF 파일 읽기 (pdf-parse 사용)
async function readPdfFile(driveId: string, itemId: string, accessToken: string) {
  console.log("=== PDF 읽기 시작 ===");

  try {
    // 1. PDF 파일 다운로드
    const downloadRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!downloadRes.ok) {
      console.log("PDF 다운로드 실패:", downloadRes.status);
      
      // 파일 정보라도 가져오기
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

    // 2. ArrayBuffer로 변환
    const arrayBuffer = await downloadRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log("PDF 다운로드 완료, 크기:", buffer.length);

    // 3. pdf-parse로 텍스트 추출
    const pdfData = await pdf(buffer);
    
    console.log("PDF 파싱 완료, 페이지 수:", pdfData.numpages);
    console.log("추출된 텍스트 길이:", pdfData.text.length);

    // 4. 텍스트 정리 (최대 15000자)
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
    console.log("PDF 읽기 에러:", error.message);
    return JSON.stringify({ 
      error: "PDF 파싱 실패", 
      detail: error.message,
      suggestion: "파일 링크를 통해 직접 확인해주세요."
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

export async function POST(req: Request) {
  console.log("=== API 요청 시작 ===");
  
  try {
    const session = await getServerSession(authOptions) as any;
    
    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ 
        error: "로그인이 필요합니다." 
      }), { status: 401 });
    }

    const { messages } = await req.json();
    const cleanedMessages = cleanMessages(messages);

    const modelId = "claude-opus-4-5-20251101"; 

    const systemPrompt = `당신은 크래프톤 포트폴리오 관리 AI 어시스턴트 "진피티"입니다.

## 핵심 역할
SharePoint에서 포트폴리오사 문서를 검색하고, **반드시 내용을 읽어서** 구체적인 답변을 제공합니다.

## 데이터 위치
1. **재무제표/Cap Table/지분율**: 
   - 검색어: "[회사명] cap table" 또는 "[회사명] 재무"
   - 위치: Financialinstruments 사이트
   
2. **계약서 (BCA, SHA, ROFN, 2PP 등)**:
   - 검색어: "[회사명] Contracts Package" 또는 "[회사명] BCA"
   - 위치: Corp.Dev.StrategyDiv 사이트 > Contracts Package
   - **중요**: ROFN, 2PP 조항은 BCA 또는 Investors Rights Agreement PDF에 있음

## 사용 가능한 도구
1. **search_sharepoint**: 파일 검색
2. **get_excel_sheets**: Excel 시트 목록 조회
3. **read_excel_sheet**: Excel 특정 시트 읽기
4. **read_pdf_file**: PDF 파일 내용 읽기 ⭐ PDF도 읽을 수 있습니다!

## 작업 순서 (필수!)

### 계약서/ROFN/2PP 질문:
1. search_sharepoint로 "[회사명] BCA" 또는 "[회사명] Contracts" 검색
2. **read_pdf_file로 PDF 내용을 반드시 읽기** ⭐
3. PDF 내용에서 ROFN/2PP/Publishing Rights 조항 찾아서 답변
4. 구체적인 조건(기간, 범위, 수익배분 등) 명시

### 지분율/Cap Table 질문:
1. search_sharepoint로 "[회사명] cap table" 검색
2. get_excel_sheets로 시트 목록 확인
3. read_excel_sheet로 적절한 시트 읽기
4. 크래프톤 지분율 찾아서 답변

## 포트폴리오사 별칭
- Ruckus Games Holdings, Inc. = Ruckus
- Antistatic Studios Inc. = Antistatic
- Day 4 Night = D4N
- Gardens Interactive = Gardens
- People Can Fly = PCF
- Unknown Worlds = UW

## 답변 원칙
1. **PDF도 읽을 수 있으니 반드시 read_pdf_file 도구를 사용해서 내용 확인**
2. "확인해보겠습니다"라고 했으면 실제로 도구 사용해서 확인
3. 구체적인 조항 내용, 숫자, 조건을 답변에 포함
4. 출처(파일명, 날짜) 명시
5. 한국어로 친절하고 상세하게 답변`;

    const tools = [
      {
        name: "search_sharepoint",
        description: "SharePoint에서 파일을 검색합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: { 
              type: "string", 
              description: "검색어. 예: 'Ruckus BCA', 'Antistatic Contracts', 'D4N cap table'" 
            }
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
            driveId: { type: "string", description: "드라이브 ID" },
            itemId: { type: "string", description: "파일 ID" }
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
            driveId: { type: "string", description: "드라이브 ID" },
            itemId: { type: "string", description: "파일 ID" },
            sheetName: { type: "string", description: "읽을 시트 이름" }
          },
          required: ["driveId", "itemId", "sheetName"]
        }
      },
      {
        name: "read_pdf_file",
        description: "PDF 파일의 텍스트 내용을 읽습니다. 계약서(BCA, ROFN, 2PP 등) 확인 시 반드시 사용하세요.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string", description: "드라이브 ID" },
            itemId: { type: "string", description: "파일 ID" }
          },
          required: ["driveId", "itemId"]
        }
      }
    ];

    let currentMessages = [...cleanedMessages];
    let response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 8192,
      system: systemPrompt,
      messages: currentMessages,
      tools: tools
    });

    // Tool 호출 루프 (최대 10회)
    let loopCount = 0;
    while (response.stop_reason === 'tool_use' && loopCount < 10) {
      loopCount++;
      console.log(`Tool 호출 #${loopCount}`);

      const toolCalls = response.content.filter((c: any) => c.type === 'tool_use');
      const toolResults: any[] = [];

      for (const toolCall of toolCalls) {
        const tc = toolCall as any;
        console.log("Tool:", tc.name, "Input:", JSON.stringify(tc.input));

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

        console.log("Tool 결과 길이:", result.length);
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

      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 8192,
        system: systemPrompt,
        messages: currentMessages,
        tools: tools
      });
    }

    console.log("최종 응답, 루프 횟수:", loopCount);
    return new Response(JSON.stringify({ content: response.content }));

  } catch (error: any) {
    console.error("에러:", error.message);
    return new Response(JSON.stringify({ 
      error: "오류가 발생했습니다. 채팅창을 닫고 새로 시작해주세요." 
    }), { status: 500 });
  }
}
