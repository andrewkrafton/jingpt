"use client";

import React, { useEffect, useState } from 'react';
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Building2, FileText } from 'lucide-react';

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [hasAtlassian, setHasAtlassian] = useState(false);
  const [checking, setChecking] = useState(true);

  // Atlassian 연결 상태 확인
  useEffect(() => {
    const checkAtlassian = async () => {
      try {
        const res = await fetch('/api/auth/atlassian/status');
        const data = await res.json();
        setHasAtlassian(data.connected);
      } catch (e) {
        setHasAtlassian(false);
      }
      setChecking(false);
    };
    checkAtlassian();
  }, [searchParams]);

  // 둘 다 연결되면 채팅으로
  useEffect(() => {
    if (session?.accessToken && hasAtlassian && !checking) {
      router.push('/chat');
    }
  }, [session, hasAtlassian, checking, router]);

  if (status === "loading" || checking) {
    return (
      <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center text-gray-400">
        로딩 중...
      </div>
    );
  }

  const hasAzure = !!session?.accessToken;

  const handleAtlassianLogin = () => {
    window.location.href = '/api/auth/atlassian';
  };

  return (
    <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center p-6">
      <div className="text-center max-w-md w-full">
        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-purple-500/20">
          <Bot size={48} className="text-white" />
        </div>
        <h1 className="text-3xl font-extrabold text-white mb-3">JinGPT Portal</h1>
        <p className="text-gray-400 mb-10 text-sm leading-relaxed">
          SharePoint와 Confluence 데이터에 접근하려면<br />두 계정 모두 연결이 필요합니다.
        </p>

        <div className="space-y-4">
          {/* Azure AD (SharePoint) */}
          <div className={`p-4 rounded-xl border ${hasAzure ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-[#161b22]'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 size={24} className={hasAzure ? 'text-green-400' : 'text-blue-400'} />
                <div className="text-left">
                  <p className="text-white font-medium">SharePoint</p>
                  <p className="text-xs text-gray-400">재무제표, 계약서</p>
                </div>
              </div>
              {hasAzure ? (
                <span className="text-green-400 text-sm font-medium">✓ 연결됨</span>
              ) : (
                <button 
                  onClick={() => signIn("azure-ad")}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  연결하기
                </button>
              )}
            </div>
          </div>

          {/* Atlassian (Confluence) */}
          <div className={`p-4 rounded-xl border ${hasAtlassian ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-[#161b22]'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText size={24} className={hasAtlassian ? 'text-green-400' : 'text-blue-400'} />
                <div className="text-left">
                  <p className="text-white font-medium">Confluence</p>
                  <p className="text-xs text-gray-400">위키 문서</p>
                </div>
              </div>
              {hasAtlassian ? (
                <span className="text-green-400 text-sm font-medium">✓ 연결됨</span>
              ) : (
                <button 
                  onClick={handleAtlassianLogin}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  연결하기
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 둘 다 연결되면 시작 버튼 */}
        {hasAzure && hasAtlassian && (
          <button 
            onClick={() => router.push('/chat')}
            className="w-full mt-8 py-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-lg transition-all"
          >
            JinGPT 시작하기
          </button>
        )}

        {/* 하나만 연결된 경우 안내 */}
        {(hasAzure || hasAtlassian) && !(hasAzure && hasAtlassian) && (
          <p className="mt-6 text-sm text-amber-400">
            ⚠️ 모든 기능을 사용하려면 두 계정 모두 연결해주세요.
          </p>
        )}

        {/* SharePoint만 연결해도 일단 진행 가능 */}
        {hasAzure && !hasAtlassian && (
          <button 
            onClick={() => router.push('/chat')}
            className="w-full mt-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium text-sm transition-all"
          >
            SharePoint만 사용하기 (Confluence 제외)
          </button>
        )}
      </div>
    </div>
  );
}
