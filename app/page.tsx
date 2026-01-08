"use client";

import { useSession, signIn, signOut } from "next-auth/react";
// ... (기타 import는 동일)

export default function JingptPortal() {
  const { data: session } = useSession();
  // ... (기타 상태 변수는 동일)

  // 로그인 안 되어 있으면 로그인 화면 보여주기
  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center">
        <div className="text-center">
          <Bot size={64} className="mx-auto mb-6 text-purple-500" />
          <h1 className="text-3xl font-bold mb-8">JinGPT 지식베이스</h1>
          <button 
            onClick={() => signIn("azure-ad")}
            className="px-8 py-4 bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition-all"
          >
            크래프톤 계정으로 로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0e14] text-gray-100">
      <nav className="border-b border-gray-800 px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="text-purple-500" />
          <span className="font-bold">JinGPT</span>
        </div>
        <div className="flex items-center gap-4">
          {/* 💡 여기가 핵심! 로그인한 사람의 이름과 사진이 나옵니다 */}
          <span className="text-sm text-gray-400">{session.user?.name} 님</span>
          <button onClick={() => signOut()} className="text-xs text-gray-500 hover:text-white">로그아웃</button>
        </div>
      </nav>
      {/* ... (이후 메인 컨텐츠는 동일) */}
    </div>
  );
}
