import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../../lib/auth"; 

export const runtime = 'nodejs';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

// SharePoint 검색 경로 설정
const SEARCH_PATHS = {
  contracts: "sites/Corp.Dev.StrategyDiv/Shared Documents/1. M&A/1. Invested",
  financials: "sites/Financialinstruments/Shared Documents/Accounting Team/1. 투자사재무제표"
};

// 검색어 분석해서 어디서 검색할지 결정
function getSearchType(query: string): 'contracts' | 'financials' | 'both' {
  const q = query.toLowerCase();
  
  const financialKeywords = ['재무', 'cap table', 'captable', '지분', 'financial', '회계', '재무제표'];
  const contractKeywords = ['계약', 'contract', 'bca', 'sha', 'ssa', 'spa', 'agreement', 'rofn', '2pp', '퍼블리싱', 'pmi'];
  
  const isFinancial = financialKeywords.some(kw => q.includes(kw));
  const isContract = contractKeywords.some(kw => q.includes(kw));
  
  if (isFinancial && !isContract) return 'financials';
  if (isContract && !isFinancial) return 'contracts';
  return 'both';
}

// 회사명 추출 (키워드 제거)
function extractCompanyName(query: string): string {
  return query
    .replace(/계약서|계약|재무제표|재무|cap\s*table|지분율|지분|financial|contract|bca|sha|rofn|2pp|퍼블리싱|pmi|확인|알려줘|찾아줘|검색|해줘/gi, '')
    .trim();
}

async function searchSharePoint(query: string, accessToken: string) {
  console.log("=== SharePoint 검색 시작 ===");
  console.log("원본 검색어:", query);

  if (!accessToken) {
    return JSON.stringify({ error: "인증 토큰이 없습니다. 다시 로그인해주세요." });
  }

  const searchType = getSearchType(query);
  const companyName = extractCompanyName(query);
  
  console.log("검색 타입:", searchType);
  console.log("회사명:", companyName);

  const allResults: any[] = [];
  const pathsToSearch = searchType === 'both' 
    ? [SEARCH_PATHS.contracts, SEARCH_PATHS.financials]
    : [SEARCH_PATHS[searchType]];

  for (const searchPath of pathsToSearch) {
    // path 필터로 특정 폴더만 검색
    const searchQuery = companyName 
      ? `"${companyName}" path:"${searchPath}"`
      : `path:"${searchPath}"`;
    
    console.log("실행 쿼리:", searchQuery);

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

      console.log("응답 상태:", res.status);

      if (!res.ok) {
        const errorData = await res.json();
        console.log("API 에러:", JSON.stringify(errorData));
        continue;
      }

      const data = await res.json();
      const hits = data.value?.[0]?.hitsContainers?.[0]?.hits || [];
      
      console.log("검색 결과 수:", hits.length);

      const sourceName = searchPath.includes('투자사재무제표') ? '재무제표' : '계약서';

      for (const hit of hits) {
        allResults.push({
          name: hit.resource.name,
          webUrl: hit.resource.webUrl,
          lastModified: hit.resource.fileSystemInfo?.lastModifiedDateTime,
          source: sourceName
        });
      }
    } catch (error: any) {
      console.log("검색 에러:", error.message);
    }
  }

  if (allResults.length === 0) {
    return JSON.stringify({ 
      message: `"${companyName || query}" 관련 검색 결과가 없습니다.`,
      searchedIn: searchType
    });
  }

  return JSON.stringify(allResults);
}

// 메시지 정리 (tool_use 히스토리 제거)
function cleanMessages(messages: any[]) {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    if (Array.isArray(msg.content)) {
      const textContent = msg.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
      return { role: msg.role, content: textContent || '' };
    }
    return { role: msg.role, content: String(msg.content) };
  }).filter(msg => msg.content);
}

export async function POST(req: Request) {
  console.log("=== API 요청 시작 ===");
  
  try {
    const session = await getServerSession(authOptions) as any;
    
    console.log("세션 사용자:", session?.user?.email);
    console.log("accessToken 존재:", !!session?.accessToken);

    if (!session || !session.accessToken) {
      return new Response(JSON.stringify({ 
        error: "로그인이 필요합니다. 로그아웃 후 다시 로그인해주세요." 
      }), { status: 401 });
    }

    const { messages } = await req.json();
    const cleanedMessages = cleanMessages(messages);
    console.log("메시지 수:", cleanedMessages.length);

    const modelId = "claude-sonnet-4-5-20250929"; 

    const systemPrompt = `당신은 크래프톤 포트폴리오 관리 AI 어시스턴트 "진피티"입니다.

## 검색 가능한 데이터
1. **계약서**: Corp.Dev.StrategyDiv > Contracts Package (BCA, SHA, SSA, ROFN, 2PP 등)
2. **재무제표**: Financialinstruments > 투자사재무제표 (Cap Table, 지분율 등)

## 포트폴리오사 별칭
- Coconut horse = Cyancook
- The Architects Republic SAS = Arkrep  
- NB Creative Proprietary Asset = Cor3
- Ruckus Games = Ruckus
- Gardens Interactive = Gardens
- Day 4 Night = D4N
- Wolf Haus Games = WHG
- People Can Fly = PCF
- Unknown Worlds = UW

## 답변 원칙
1. search_sharepoint 도구로 파일 검색
2. 검색 결과의 webUrl 링크를 반드시 제공
3. 지분율은 최신 분기 Cap Table 참조
4. 출처를 명확히 표시
5. 한국어로 친절하게 답변`;

    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: systemPrompt,
      messages: cleanedMessages,
      tools: [{
        name: "search_sharepoint",
        description: "SharePoint에서 포트폴리오사 관련 파일을 검색합니다. 계약서(BCA, SHA, ROFN, 2PP)나 재무제표(Cap Table, 지분율)를 찾습니다.",
        input_schema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "검색할 내용. 예: 'Ruckus Cap Table', 'Antistatic 계약서', 'D4N BCA'"
            }
          },
          required: ["query"]
        }
      }]
    });

    console.log("첫 번째 응답:", response.stop_reason);

    if (response.stop_reason !== 'tool_use') {
      return new Response(JSON.stringify({ content: response.content }));
    }

    const toolCall = response.content.find((c: any) => c.type === 'tool_use') as any;
    console.log("Tool 입력:", toolCall?.input);

    const toolResult = await searchSharePoint(toolCall.input.query, session.accessToken);
    console.log("검색 결과 미리보기:", toolResult.slice(0, 500));

    const finalResponse = await anthropic.messages.create({
      model: modelId,
      max_tokens: 4096,
      system: `검색 결과를 보기 좋게 정리해주세요.
- 각 파일의 이름과 링크(webUrl)를 클릭 가능하게 제공
- 출처(재무제표/계약서)를 명시
- 최신 파일을 우선 안내
- 한국어로 친절하게 답변`,
      messages: [
        ...cleanedMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: toolResult }] }
      ]
    });

    console.log("두 번째 응답 완료");
    return new Response(JSON.stringify({ content: finalResponse.content }));

  } catch (error: any) {
    console.error("에러:", error.message);
    return new Response(JSON.stringify({ 
      error: "오류가 발생했습니다. 채팅창을 닫고 새로 시작해주세요." 
    }), { status: 500 });
  }
}
