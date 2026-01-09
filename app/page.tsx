"use client";

import React, { useEffect, useState } from 'react';
import { useSession, signOut } from "next-auth/react";
import { useRouter } from 'next/navigation';
import { 
  Bot, FileText, PieChart, ShieldCheck, 
  Bell, Info, ChevronRight
} from 'lucide-react';

const ANNOUNCEMENTS = [
  { id: 1, date: '2026-01-09', title: 'JinGPT v2.0 정식 출시! (Confluence 연동 추가)', tag: '신규' },
  { id: 2, date: '2026-01-08', title: '2025 Q4 재무제표 업데이트 완료', tag: '안내' },
];

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [hasAtlassian, setHasAtlassian] = useState(false);

  useEffect(() => {
    const checkAtlassian = async () => {
      try {
        const res = await fetch('/api/auth/atlassian/status');
        const data = await res.json();
        setHasAtlassian(data.connected);
      } catch (e) {
        setHasAtlassian(false);
      }
    };
    checkAtlassian();
  }, []);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center text-gray-400">
        인증 상태 확인 중...
      </div>
    );
  }

  if (!session?.accessToken) {
    router.push('/login');
    return null;
  }

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
            <div className="flex items-center gap-2">
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">SharePoint ✓</span>
              {hasAtlassian ? (
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded">Confluence ✓</span>
              ) : (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded cursor-pointer" onClick={() => router.push('/login')}>Confluence ✗</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-300">{session.user?.name} 님</span>
              <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-[10px] bg-gray-800 px-2 py-1 rounded hover:bg-gray-700 transition-colors">로그아웃</button>
            </div>
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
              진피티는 SharePoint와 Confluence에 있는 계약서, 재무제표, 위키 문서를 실시간으로 분석하여 가장 정확한 답변을 제공합니다.
            </p>
            <button 
              onClick={() => router.push('/chat')}
              className="px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-lg transition-all flex items-center gap-2 shadow-lg shadow-purple-500/20 active:scale-95"
            >
              대화 시작하기 <ChevronRight size={20} />
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard icon={<PieChart className="text-blue-400" />} title="지분율 조회" desc="최신 분기 Cap Table 기반으로 실시간 지분율 정보를 제공합니다." />
            <FeatureCard icon={<FileText className="text-purple-400" />} title="계약서 검색" desc="Contracts Package 내 BCA, ROFN 등 주요 계약 조건을 찾아드립니다." />
            <FeatureCard icon={<ShieldCheck className="text-green-400" />} title="위키 문서" desc="Confluence에 정리된 포트폴리오사 정보를 검색합니다." />
            <FeatureCard icon={<Info className="text-amber-400" />} title="재무제표 확인" desc="각 포트폴리오사의 분기별 재무 지표를 요약해드립니다." />
          </div>

          <div className="bg-[#161b22] border border-gray-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold flex items-center gap-2 mb-6"><Bell size={18} className="text-purple-400" /> 공지사항</h3>
            <div className="space-y-4">
              {ANNOUNCEMENTS.map(item => (
                <div key={item.id} className="group cursor-pointer border-b border-gray-800 pb-3 last:border-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${item.tag === '신규' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>{item.tag}</span>
                    <span className="text-xs text-gray-500">{item.date}</span>
                  </div>
                  <p className="text-sm text-gray-300 group-hover:text-white transition-colors">{item.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
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
