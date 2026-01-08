import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// 회사명 추출
function extractCompanyName(query: string): string {
  return query
    .replace(/계약서|계약|재무제표|재무|cap\s*table|지분율|지분|financial|contract|bca|sha|rofn|2pp|퍼블리싱|pmi|확인|알려줘|찾아줘|검색|해줘|을|를|의|읽어|내용/gi, '')
    .trim();
}

// SharePoint 파일 검색
async function searchSharePoint(query: string, accessToken: string) {
  console.log("=== SharePoint 검색 시작 ===");
  const companyName = extractCompanyName(query);
  const searchQuery = companyName || query;
  
  console.log("검색 쿼리:", searchQuery);

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
          query: { queryString: searchQuery }, 
          from: 0, 
          size: 10 
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
      return JSON.stringify({ message: `"${searchQuery}" 검색 결과가 없습니다.` });
    }

    const results = hits.map((hit: any) => {
      const webUrl = hit.resource.webUrl || '';
      let source = '기타';
      if (webUrl.includes('Financialinstruments') || webUrl.includes('투자사재무제표')) {
        source = '재무제표';
      } else if (webUrl.includes('Corp.Dev.StrategyDiv')) {
        source = '계약서/PMI';
      }

      return {
        name: hit.resource.name,
        webUrl: webUrl,
        driveId: hit.resource.parentReference?.driveId,
        itemId: hit.resource.id,
        lastModified: hit.resource.fileSystemInfo?.lastModifiedDateTime,
        source: source
      };
    });

    return JSON.stringify(results);
  } catch (error: any) {
    return JSON.stringify({ error: "검색 실패", detail: error.message });
  }
}

// Excel 파일 내용 읽기
async function readExcelFile(driveId: string, itemId: string, accessToken: string) {
  console.log("=== Excel 파일 읽기 시작 ===");
  console.log("driveId:", driveId);
  console.log("itemId:", itemId);

  try {
    // 먼저 워크시트 목록 가져오기
    const sheetsRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!sheetsRes.ok) {
      const error = await sheetsRes.json();
      console.log("워크시트 목록 에러:", error);
      return JSON.stringify({ error: "파일을 읽을 수 없습니다.", detail: error.error?.message });
    }

    const sheetsData = await sheetsRes.json();
    const sheets = sheetsData.value || [];
    console.log("워크시트 수:", sheets.length);

    if (sheets.length === 0) {
      return JSON.stringify({ error: "워크시트가 없습니다." });
    }

    // 첫 번째 시트 (또는 Summary/Cap Table 시트) 내용 읽기
    let targetSheet = sheets[0];
    for (const sheet of sheets) {
      const name = sheet.name.toLowerCase();
      if (name.includes('summary') || name.includes('cap') || name.includes('지분')) {
        targetSheet = sheet;
        break;
      }
    }

    console.log("읽을 시트:", targetSheet.name);

    // 사용된 범위 데이터 가져오기
    const rangeRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/workbook/worksheets('${encodeURIComponent(targetSheet.name)}')/usedRange`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!rangeRes.ok) {
      const error = await rangeRes.json();
      console.log("범위 읽기 에러:", error);
      return JSON.stringify({ error: "시트 내용을 읽을 수 없습니다.", detail: error.error?.message });
    }

    const rangeData = await rangeRes.json();
    const values = rangeData.values || [];
    
    console.log("읽은 행 수:", values.length);

    // 데이터를 텍스트로 정리 (최대 50행)
    const maxRows = Math.min(values.length, 50);
    let content = `시트명: ${targetSheet.name}\n\n`;
    
    for (let i = 0; i < maxRows; i++) {
      const row = values[i];
      if (row && row.some((cell: any) => cell !== null && cell !== '')) {
        content += row.map((cell: any) => cell ?? '').join(' | ') + '\n';
      }
    }

    if (values.length > 50) {
      content += `\n... (총 ${values.length}행 중 50행만 표시)`;
    }

    return JSON.stringify({ 
      sheetName: targetSheet.name,
      totalRows: values.length,
      content: content
    });

  } catch (error: any) {
    console.log("Excel 읽기 에러:", error.message);
    return JSON.stringify({ error: "파일 읽기 실패", detail: error.message });
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
  return cleaned.slice(-4);
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

    const modelId = "claude-sonnet-4-5-20250929"; 

    const systemPrompt = `당신은 크래프톤 포트폴리오 관리 AI 어시스턴트 "진피티"입니다.

## 핵심 역할
SharePoint에서 포트폴리오사 문서를 **검색하고, 내용을 읽어서** 사용자에게 답변합니다.

## 사용 가능한 도구
1. **search_sharepoint**: 파일 검색 (회사명으로 검색)
2. **read_excel_file**: Excel 파일 내용 읽기 (driveId, itemId 필요)

## 작업 순서 (중요!)
1. 먼저 search_sharepoint로 관련 파일을 찾습니다
2. 찾은 파일 중 가장 적절한 것의 driveId, itemId로 read_excel_file을 호출합니다
3. 읽은 내용을 분석해서 사용자 질문에 답변합니다

## 포트폴리오사 별칭
- Ruckus Games Holdings = Ruckus
- Day 4 Night = D4N
- Antistatic Studios = Antistatic
- People Can Fly = PCF

## 답변 원칙
- 파일을 찾으면 반드시 내용을 읽어서 구체적인 숫자/정보를 제공하세요
- "확인해보겠습니다"라고 했으면 실제로 확인해서 결과를 알려주세요
- 지분율 질문이면 Cap Table 파일을 읽어서 크래프톤 지분율을 알려주세요`;

    const tools = [
      {
        name: "search_sharepoint",
        description: "SharePoint에서 파일을 검색합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "검색할 회사명 또는 키워드" }
          },
          required: ["query"]
        }
      },
      {
        name: "read_excel_file",
        description: "Excel 파일의 내용을 읽어옵니다. search_sharepoint 결과에서 driveId와 itemId를 사용합니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            driveId: { type: "string", description: "파일이 있는 드라이브 ID" },
            itemId: { type: "string", description: "파일 ID" }
          },
          required: ["driveId", "itemId"]
        }
      }
    ];

    let currentMessages = [...cleanedMessages];
    let response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: currentMessages,
      tools: tools
    });

    // Tool 호출 루프 (최대 5회)
    let loopCount = 0;
    while (response.stop_reason === 'tool_use' && loopCount < 5) {
      loopCount++;
      console.log(`Tool 호출 #${loopCount}`);

      const toolCalls = response.content.filter((c: any) => c.type === 'tool_use');
      const toolResults: any[] = [];

      for (const toolCall of toolCalls) {
        const tc = toolCall as any;
        console.log("Tool:", tc.name, "Input:", JSON.stringify(tc.input));

        let result = '';
        if (tc.name === 'search_sharepoint') {
          result = await searchSharePoint(tc.input.query, session.accessToken);
        } else if (tc.name === 'read_excel_file') {
          result = await readExcelFile(tc.input.driveId, tc.input.itemId, session.accessToken);
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

      response = await anthropic.messages.create({
        model: modelId,
        max_tokens: 4096,
        system: systemPrompt,
        messages: currentMessages,
        tools: tools
      });
    }

    console.log("최종 응답 완료, 루프 횟수:", loopCount);
    return new Response(JSON.stringify({ content: response.content }));

  } catch (error: any) {
    console.error("에러:", error.message);
    return new Response(JSON.stringify({ 
      error: "오류가 발생했습니다. 채팅창을 닫고 새로 시작해주세요." 
    }), { status: 500 });
  }
}
