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
