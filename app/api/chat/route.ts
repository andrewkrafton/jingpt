import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// 회사명 추출
function extractCompanyName(query: string): string {
  return query
    .replace(/계약서|계약|재무제표|재무|cap\s*table|지분율|지분|financial|contract|bca|sha|rofn|2pp|퍼블리싱|pmi|확인|알려줘|찾아줘|검색|해줘|을|를|의|읽어|내용|있는지|있어/gi, '')
    .trim();
}

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

      // 파일 타입 판별
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
        // 검색 스니펫 (PDF 내용 미리보기용)
        summary: hit.summary || ''
      };
    });

    return JSON.stringify(results);
  } catch (error: any) {
    return JSON.stringify({ error: "검색 실패", detail: error.message });
  }
}

// Excel 파일의 모든 시트 목록 가져오기
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

    // 데이터를 텍스트로 정리 (최대 100행)
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

// PDF 파일 텍스트 추출 (Microsoft Graph 변환 API 사용)
async function readPdfFile(driveId: string, itemId: string, accessToken: string) {
  console.log("=== PDF 읽기 시도 ===");

  try {
    // 방법 1: PDF를 HTML로 변환해서 텍스트 추출 시도
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content?format=html`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (res.ok) {
      const html = await res.text();
      // HTML 태그 제거하고 텍스트만 추출
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const truncated = text.slice(0, 10000); // 최대 10000자
      
      console.log("PDF 텍스트 추출 성공, 길이:", truncated.length);
      return JSON.stringify({ content: truncated, truncated: text.length > 10000 });
    }

    // 방법 2: 변환 실패 시 파일 메타데이터라도 반환
    console.log("PDF HTML 변환 실패, 상태:", res.status);
    
    // 파일 정보 가져오기
    const infoRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    
    if (infoRes.ok) {
      const info = await infoRes.json();
      return JSON.stringify({ 
        error: "PDF 내용을 직접 읽을 수 없습니다.",
        fileName: info.name,
        webUrl: info.webUrl,
        size: info.size,
        suggestion: "링크를 통해 직접 확인해주세요."
      });
    }

    return JSON.stringify({ error: "PDF 파일을 읽을 수 없습니다." });
  } catch (error: any) {
    console.log("PDF 읽기 에러:", error.message);
    return JSON.stringify({ error: "PDF 읽기 실패", detail: error.message });
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

    // Opus 4.5로 변경!
    const modelId = "claude-opus-4-5-20251101"; 

    const systemPrompt = `당신은 크래프톤 포트폴리오 관리 AI 어시스턴트 "진피티"입니다.

## 핵심 역할
SharePoint에서 포트폴리오사 문서를 검색하고, **반드시 내용을 읽어서** 구체적인 답변을 제공합니다.

## 데이터 위치 (중요!)
1. **재무제표/Cap Table/지분율**: 
   - 검색어: "[회사명] cap table" 또는 "[회사명] 재무"
   - 위치: Financialinstruments 사이트 > 투자사재무제표
   
2. **계약서 (BCA, SHA, ROFN, 2PP 등)**:
   - 검색어: "[회사명] Contracts Package" 또는 "[회사명] BCA"
   - 위치: Corp.Dev.StrategyDiv 사이트 > Contracts Package > [회사명] 폴더
   - ROFN은 보통 Investors Rights Agreement 또는 BCA에 포함

## 사용 가능한 도구
1. **search_sharepoint**: 파일 검색
2. **get_excel_sheets**: Excel 파일의 시트 목록 조회
3. **read_excel_sheet**: Excel 특정 시트 읽기 (시트명 지정 필수)
4. **read_pdf_file**: PDF 파일 읽기

## 작업 순서 (필수!)
### 지분율/Cap Table 질문:
1. search_sharepoint로 "[회사명] cap table" 검색
2. get_excel_sheets로 시트 목록 확인
3. "Detailed Cap" 또는 "Intermediate Cap" 시트를 read_excel_sheet로 읽기
4. 크래프톤 지분율 찾아서 답변

### 계약서/ROFN/2PP 질문:
1. search_sharepoint로 "[회사명] Contracts Package" 검색
2. 관련 파일 (Investors Rights Agreement, BCA 등) 찾기
3. read_pdf_file로 내용 읽기
4. ROFN/2PP 조항 찾아서 답변

## 포트폴리오사 별칭
- Ruckus Games Holdings, Inc. = Ruckus
- Antistatic Studios Inc. = Antistatic
- Day 4 Night = D4N
- Gardens Interactive = Gardens
- People Can Fly = PCF
- Unknown Worlds = UW
- Coconut horse, Inc. = Cyancook
- The Architects Republic SAS = Arkrep
- NB Creative Proprietary Asset = Cor3
- Wolf Haus Games = WHG

## 답변 원칙
1. "확인해보겠습니다"라고 했으면 **반드시** 도구를 사용해서 실제로 확인
2. 파일을 찾으면 **반드시** 내용을 읽어서 구체적인 숫자/정보 제공
3. 시트가 여러 개면 적절한 시트를 선택해서 읽기
4. 출처(파일명, 날짜)를 명시
5. 한국어로 친절하고 상세하게 답변`;

    const tools = [
      {
        name: "search_sharepoint",
        description: "SharePoint에서 파일을 검색합니다. 회사명, 문서 유형 등으로 검색 가능합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: { 
              type: "string", 
              description: "검색어. 예: 'Ruckus Games cap table', 'Antistatic Contracts Package', 'D4N BCA'" 
            }
          },
          required: ["query"]
        }
      },
      {
        name: "get_excel_sheets",
        description: "Excel 파일의 시트 목록을 조회합니다. 어떤 시트가 있는지 먼저 확인할 때 사용합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string", description: "드라이브 ID (search_sharepoint 결과에서 획득)" },
            itemId: { type: "string", description: "파일 ID (search_sharepoint 결과에서 획득)" }
          },
          required: ["driveId", "itemId"]
        }
      },
      {
        name: "read_excel_sheet",
        description: "Excel 파일의 특정 시트 내용을 읽습니다. 시트명을 정확히 지정해야 합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string", description: "드라이브 ID" },
            itemId: { type: "string", description: "파일 ID" },
            sheetName: { type: "string", description: "읽을 시트 이름. get_excel_sheets로 먼저 확인 권장." }
          },
          required: ["driveId", "itemId", "sheetName"]
        }
      },
      {
        name: "read_pdf_file",
        description: "PDF 파일의 텍스트 내용을 읽습니다. 계약서 등 PDF 문서 확인 시 사용합니다.",
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

    // Tool 호출 루프 (최대 8회)
    let loopCount = 0;
    while (response.stop_reason === 'tool_use' && loopCount < 8) {
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
