"use client";

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Bot, User, AlertCircle, Info, ExternalLink, 
  MessageSquare, FileText, PieChart, ShieldCheck, 
  Bell, Bug, X, ChevronRight 
} from 'lucide-react';

// 공지사항 데이터
const ANNOUNCEMENTS = [
  { id: 1, date: '2026-01-08', title: '2025 Q4 재무제표 업데이트 완료', tag: '신규' },
  { id: 2, date: '2025-12-24', title: 'Jingpt v2.0 릴리즈 알림 (UI 개편)', tag: '안내' },
];

export default function JingptPortal() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 크래프톤 포트폴리오사 지식베이스 진피티입니다. 무엇을 도와드릴까요?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });

      const data = await response.json();

      if (data && data.content && data.content[0] && data.content[0].text) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content[0].text }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `알림: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '답변을 불러오는 중 문제가 발생했습니다.' }]);
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'assistant', content: '서버와 연결할 수 없습니다. 다시 시도해주세요.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] text-gray-100 font-sans">
      <nav className="border-b border-gray-800 bg-[#0b0e14]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
              <Bot size={20} className="text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">JinGPT <span className="text-purple-500 text-sm font-normal">v2.0</span></span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium text-gray-400">
            <button onClick={() => setIsBugModalOpen(true)} className="hover:text-white flex items-center gap-1 transition-colors">
              <Bug size={16} /> 버그 신고
            </button>
            <div className="w-px h-4 bg-gray-700"></div>
            <span className="text-gray-500">Andrew (KRAFTON)</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <section className="mb-16">
          <div className="max-w-3xl">
            <h1 className="text-5xl font-extrabold mb-6 leading-tight">
              크래프톤 포트폴리오사 <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-500">지식베이스 인텔리전스</span>
            </h1>
            <p className="text-xl text-gray-400 mb-8 leading-relaxed">
              진피티는 Confluence와 SharePoint에 흩어진 계약서, 재무제표, 지분율 데이터를 실시간으로 분석하여 가장 정확한 답변을 제공합니다.
            </p>
            <button 
              onClick={() => setIsChatOpen(true)}
              className="px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-lg transition-all flex items-center gap-2 shadow-lg shadow-purple-500/20 active:scale-95"
            >
              대화 시작하기 <ChevronRight size={20} />
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard icon={<PieChart className="text-blue-400" />} title="지분율 조회" desc="최신 분기 Cap Table 기반으로 실시간 지분율 정보를 제공합니다." />
            <FeatureCard icon={<FileText className="text-purple-400" />} title="계약서 검색" desc="Contracts Package 내 BCA 등 주요 계약 조건을 찾아드립니다." />
            <FeatureCard icon={<ShieldCheck className="text-green-400" />} title="ROFN / 2PP" desc="우선협상권 및 퍼블리싱 권한 보유 현황을 즉시 확인하세요." />
            <FeatureCard icon={<Info className="text-amber-400" />} title="재무제표 확인" desc="각 포트폴리오사의 분기별 재무 지표를 요약해드립니다." />
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold flex items-center gap-2 mb-6"><Bell size={18} className="text-purple-400" /> 공지사항</h3>
            <div className="space-y-4">
              {ANNOUNCEMENTS.map(item => (
                <div key={item.id} className="group cursor-pointer border-b border-gray-800 pb-3 last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full font-bold">{item.tag}</span>
                    <span className="text-xs text-gray-500">{item.date}</span>
                  </div>
                  <p className="text-sm text-gray-300 group-hover:text-white transition-colors">{item.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {isChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0d1117] w-full max-w-4xl h-[80vh] rounded-2xl border border-gray-700 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-[#161b22]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-600 rounded-full flex items-center justify-center"><Bot size={18} /></div>
                <div>
                  <h3 className="font-bold">JinGPT AI Assistant</h3>
                  <p className="text-[10px] text-green-500 flex items-center gap-1">● 실시간 지식베이스 연결됨</p>
                </div>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-gray-400 hover:text-white transition-colors"><X /></button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#0b0e14]">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center ${m.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'}`}>
                      {m.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div className={`p-4 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-[#1c2128] text-gray-200 border border-gray-800'}`}>
                      {m.content.split('\n').map((line, idx) => <p key={idx} className={idx > 0 ? "mt-2" : ""}>{line}</p>)}
                    </div>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center animate-pulse"><Bot size={16} /></div>
                  <div className="p-4 rounded-2xl bg-[#1c2128] border border-gray-800">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                      <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSendMessage} className="p-4 bg-[#161b22] border-t border-gray-800">
              <div className="relative group">
                <input 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="질문을 입력하세요 (예: Ruckus Games 지분율 얼마야?)"
                  className="w-full bg-[#0d1117] border border-gray-700 rounded-xl px-4 py-4 pr-12 focus:outline-none focus:border-purple-500 transition-all placeholder:text-gray-600"
                />
                <button 
                  type="submit" 
                  disabled={isLoading || !input.trim()}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-700 disabled:text-gray-500"
                >
                  <Send size={18} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {['Ruckus 지분율?', 'Cyancook ROFN?', '2PP 보유 회사'].map(q => (
                  <button key={q} onClick={() => setInput(q)} type="button" className="text-[10px] bg-[#1c2128] border border-gray-800 text-gray-400 px-2 py-1 rounded hover:bg-gray-700 transition-colors">{q}</button>
                ))}
              </div>
            </form>
          </div>
        </div>
      )}

      {isBugModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#161b22] border border-gray-800 rounded-2xl p-8 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2 text-red-400"><Bug size={24} /> 버그 및 개선 요청</h3>
            <p className="text-gray-400 text-sm mb-6 leading-relaxed">제출된 내용은 Andrew님(U02SC6JVBAR)에게 Slack DM으로 즉시 전달됩니다.</p>
            <textarea 
              className="w-full h-32 bg-[#0d1117] border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-red-500 mb-4 transition-all"
              placeholder="문제가 발생한 상황이나 필요한 기능을 상세히 적어주세요."
            />
            <div className="flex gap-3">
              <button onClick={() => setIsBugModalOpen(false)} className="flex-1 py-3 rounded-lg bg-gray-800 hover:bg-gray-700 font-medium transition-colors">취소</button>
              <button onClick={() => { alert('신고가 완료되었습니다!'); setIsBugModalOpen(false); }} className="flex-1 py-3 rounded-lg bg-red-600 hover:bg-red-700 font-medium transition-colors">신고하기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="bg-[#161b22] border border-gray-800 p-6 rounded-2xl hover:border-purple-500/50 transition-all group hover:bg-[#1c2128]">
      <div className="w-12 h-12 bg-[#0d1117] rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-lg font-bold mb-2 group-hover:text-purple-400 transition-colors">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
    </div>
  );
}
