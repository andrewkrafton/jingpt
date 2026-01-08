"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Send, Bot, User, Plus, MessageSquare, 
  Trash2, Menu, X, LogOut
} from 'lucide-react';

// 대화 타입 정의
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

export default function JinGPT() {
  const { data: session, status } = useSession();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // localStorage에서 대화 기록 로드
  useEffect(() => {
    const saved = localStorage.getItem('jingpt-chats');
    if (saved) {
      const parsed = JSON.parse(saved);
      setChats(parsed);
      // 가장 최근 대화 열기
      if (parsed.length > 0) {
        setCurrentChatId(parsed[0].id);
        setMessages(parsed[0].messages);
      }
    }
  }, []);

  // 대화 기록 저장
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('jingpt-chats', JSON.stringify(chats));
    }
  }, [chats]);

  // 스크롤 자동 이동
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 새 대화 시작
  const startNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: '새 대화',
      messages: [],
      createdAt: Date.now()
    };
    setChats(prev => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    setMessages([]);
  };

  // 대화 선택
  const selectChat = (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setCurrentChatId(chatId);
      setMessages(chat.messages);
    }
  };

  // 대화 삭제
  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
    }
  };

  // 메시지 전송
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    // 새 대화면 생성
    let chatId = currentChatId;
    if (!chatId) {
      const newChat: Chat = {
        id: Date.now().toString(),
        title: input.slice(0, 30) + (input.length > 30 ? '...' : ''),
        messages: [],
        createdAt: Date.now()
      };
      setChats(prev => [newChat, ...prev]);
      chatId = newChat.id;
      setCurrentChatId(chatId);
    }

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    // 대화 제목 업데이트 (첫 메시지일 때)
    if (messages.length === 0) {
      setChats(prev => prev.map(c => 
        c.id === chatId ? { ...c, title: input.slice(0, 30) + (input.length > 30 ? '...' : '') } : c
      ));
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });

      const data = await response.json();

      let assistantContent = '';
      if (data.error) {
        assistantContent = `⚠️ ${data.error}`;
      } else if (data.content && Array.isArray(data.content)) {
        for (const block of data.content) {
          if (block.type === 'text' && block.text) {
            assistantContent += block.text;
          }
        }
      }

      if (!assistantContent) {
        assistantContent = '응답을 처리하는 중 문제가 발생했습니다.';
      }

      const assistantMessage: Message = { role: 'assistant', content: assistantContent };
      const updatedMessages = [...newMessages, assistantMessage];
      setMessages(updatedMessages);

      // 대화 기록 업데이트
      setChats(prev => prev.map(c => 
        c.id === chatId ? { ...c, messages: updatedMessages } : c
      ));

    } catch (error) {
      const errorMessage: Message = { role: 'assistant', content: '서버와 연결할 수 없습니다.' };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  // 로딩 중
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center text-gray-400">
        로딩 중...
      </div>
    );
  }

  // 로그인 필요
  if (!session) {
    return (
      <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <Bot size={48} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">JinGPT</h1>
          <p className="text-gray-400 mb-8">크래프톤 포트폴리오사 지식베이스</p>
          <button 
            onClick={() => signIn("azure-ad")}
            className="w-full py-4 bg-white text-black rounded-xl font-bold hover:bg-gray-200 transition-all"
          >
            크래프톤 계정으로 로그인
          </button>
        </div>
      </div>
    );
  }

  // 메인 UI
  return (
    <div className="min-h-screen bg-[#0b0e14] flex">
      {/* 사이드바 */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} bg-[#0d1117] border-r border-gray-800 flex flex-col transition-all duration-300 overflow-hidden`}>
        {/* 새 대화 버튼 */}
        <div className="p-3">
          <button 
            onClick={startNewChat}
            className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 rounded-lg flex items-center gap-2 text-white font-medium transition-colors"
          >
            <Plus size={18} /> 새 대화
          </button>
        </div>

        {/* 대화 목록 */}
        <div className="flex-1 overflow-y-auto px-2">
          {chats.map(chat => (
            <div 
              key={chat.id}
              onClick={() => selectChat(chat.id)}
              className={`group flex items-center gap-2 px-3 py-3 rounded-lg cursor-pointer mb-1 ${
                currentChatId === chat.id ? 'bg-gray-800' : 'hover:bg-gray-800/50'
              }`}
            >
              <MessageSquare size={16} className="text-gray-500 flex-shrink-0" />
              <span className="text-sm text-gray-300 truncate flex-1">{chat.title}</span>
              <button 
                onClick={(e) => deleteChat(chat.id, e)}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* 사용자 정보 */}
        <div className="p-3 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400 truncate">{session.user?.name}</span>
            <button onClick={() => signOut()} className="text-gray-500 hover:text-white">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 메인 채팅 영역 */}
      <div className="flex-1 flex flex-col">
        {/* 헤더 */}
        <div className="h-14 border-b border-gray-800 flex items-center px-4 gap-3">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-white"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <span className="font-semibold text-white">JinGPT</span>
            <span className="text-xs text-purple-400">v2.0</span>
          </div>
        </div>

        {/* 메시지 영역 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            // 빈 상태
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-16 h-16 bg-purple-600/20 rounded-2xl flex items-center justify-center mb-6">
                <Bot size={32} className="text-purple-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">무엇을 도와드릴까요?</h2>
              <p className="text-gray-400 max-w-md">
                포트폴리오사의 지분율, 계약서, 재무제표 등을 검색하고 분석해드립니다.
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {['Ruckus 지분율', 'Antistatic 계약서', 'D4N ROFN'].map(q => (
                  <button 
                    key={q}
                    onClick={() => setInput(q)}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // 메시지 목록
            <div className="max-w-4xl mx-auto py-6 px-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-4 mb-6 ${m.role === 'user' ? 'justify-end' : ''}`}>
                  {m.role === 'assistant' && (
                    <div className="w-8 h-8 bg-purple-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                      <Bot size={18} className="text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] ${m.role === 'user' ? 'bg-blue-600 rounded-2xl px-4 py-3' : ''}`}>
                    {m.role === 'user' ? (
                      <p className="text-white">{m.content}</p>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline">
                                {children}
                              </a>
                            ),
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-4">
                                <table className="min-w-full border border-gray-700 rounded-lg overflow-hidden">
                                  {children}
                                </table>
                              </div>
                            ),
                            thead: ({ children }) => (
                              <thead className="bg-gray-800">{children}</thead>
                            ),
                            th: ({ children }) => (
                              <th className="px-4 py-2 text-left text-sm font-semibold text-gray-200 border-b border-gray-700">
                                {children}
                              </th>
                            ),
                            td: ({ children }) => (
                              <td className="px-4 py-2 text-sm text-gray-300 border-b border-gray-800">
                                {children}
                              </td>
                            ),
                            p: ({ children }) => (
                              <p className="mb-3 text-gray-200 leading-relaxed">{children}</p>
                            ),
                            h2: ({ children }) => (
                              <h2 className="text-lg font-bold text-white mt-6 mb-3">{children}</h2>
                            ),
                            h3: ({ children }) => (
                              <h3 className="text-base font-semibold text-white mt-4 mb-2">{children}</h3>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside mb-3 text-gray-300">{children}</ul>
                            ),
                            li: ({ children }) => (
                              <li className="mb-1">{children}</li>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold text-white">{children}</strong>
                            ),
                            hr: () => (
                              <hr className="my-4 border-gray-700" />
                            ),
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {m.role === 'user' && (
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                      <User size={18} className="text-white" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-4 mb-6">
                  <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                    <Bot size={18} className="text-white" />
                  </div>
                  <div className="flex items-center gap-2 text-gray-400">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                    <span className="text-sm">검색 중...</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 입력 영역 */}
        <div className="border-t border-gray-800 p-4">
          <form onSubmit={handleSend} className="max-w-4xl mx-auto">
            <div className="relative">
              <input 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="메시지를 입력하세요..."
                disabled={isLoading}
                className="w-full bg-[#1c2128] border border-gray-700 rounded-xl px-4 py-4 pr-12 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors disabled:opacity-50"
              />
              <button 
                type="submit" 
                disabled={isLoading || !input.trim()}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed"
              >
                <Send size={18} className="text-white" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
