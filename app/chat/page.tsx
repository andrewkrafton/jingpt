"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useSession, signOut } from "next-auth/react";
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Send, Bot, User, Plus, MessageSquare, 
  Trash2, Menu, X, LogOut, Home
} from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

// 시간 포맷 함수
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const timeStr = date.toLocaleTimeString('ko-KR', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  });
  
  if (isToday) {
    return timeStr;
  } else {
    const dateStr = date.toLocaleDateString('ko-KR', { 
      month: 'short', 
      day: 'numeric' 
    });
    return `${dateStr} ${timeStr}`;
  }
}

export default function ChatPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hoveredMessageIndex, setHoveredMessageIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('jingpt-chats');
    if (saved) {
      const parsed = JSON.parse(saved);
      setChats(parsed);
      if (parsed.length > 0) {
        setCurrentChatId(parsed[0].id);
        setMessages(parsed[0].messages);
      }
    }
  }, []);

  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem('jingpt-chats', JSON.stringify(chats));
    }
  }, [chats]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, statusMessage]);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/');
    }
  }, [status, router]);

  // 커스텀 로그아웃 (Atlassian 쿠키도 삭제)
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      // 에러 무시
    }
    signOut({ callbackUrl: '/login' });
  };

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

  const selectChat = (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setCurrentChatId(chatId);
      setMessages(chat.messages);
    }
  };

  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChats(prev => prev.filter(c => c.id !== chatId));
    if (currentChatId === chatId) {
      setCurrentChatId(null);
      setMessages([]);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

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

    const userMessage: Message = { 
      role: 'user', 
      content: input,
      timestamp: Date.now()
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setStatusMessage('🤔 질문 분석 중...');

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

      if (response.status === 401) {
        const errorData = await response.json();
        const errorMessage: Message = { 
          role: 'assistant', 
          content: `⚠️ ${errorData.error || '세션이 만료되었습니다.'}\n\n**해결 방법:** 왼쪽 하단의 로그아웃 버튼을 클릭하고 다시 로그인해주세요.`,
          timestamp: Date.now()
        };
        const updatedMessages = [...newMessages, errorMessage];
        setMessages(updatedMessages);
        setChats(prev => prev.map(c => 
          c.id === chatId ? { ...c, messages: updatedMessages } : c
        ));
        setIsLoading(false);
        setStatusMessage('');
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('스트림을 읽을 수 없습니다.');
      }

      let assistantContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'status') {
                setStatusMessage(data.message);
              } else if (data.type === 'final') {
                if (data.content && Array.isArray(data.content)) {
                  for (const block of data.content) {
                    if (block.type === 'text' && block.text) {
                      assistantContent += block.text;
                    }
                  }
                }
              }
            } catch (e) {
              // JSON 파싱 에러 무시
            }
          }
        }
      }

      if (!assistantContent) {
        assistantContent = '응답을 처리하는 중 문제가 발생했습니다.';
      }

      const assistantMessage: Message = { 
        role: 'assistant', 
        content: assistantContent,
        timestamp: Date.now()
      };
      const updatedMessages = [...newMessages, assistantMessage];
      setMessages(updatedMessages);

      setChats(prev => prev.map(c => 
        c.id === chatId ? { ...c, messages: updatedMessages } : c
      ));

    } catch (error) {
      const errorMessage: Message = { 
        role: 'assistant', 
        content: '⚠️ 서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
        timestamp: Date.now()
      };
      const updatedMessages = [...newMessages, errorMessage];
      setMessages(updatedMessages);
      setChats(prev => prev.map(c => 
        c.id === chatId ? { ...c, messages: updatedMessages } : c
      ));
    } finally {
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0b0e14] flex items-center justify-center text-gray-400">
        로딩 중...
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="h-screen bg-[#0b0e14] flex overflow-hidden">
      {/* 사이드바 */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} bg-[#0d1117] border-r border-gray-800 flex flex-col transition-all duration-300 overflow-hidden flex-shrink-0`}>
        {/* 사이드바 상단 - 고정 */}
        <div className="p-3 space-y-2 flex-shrink-0">
          <button 
            onClick={() => router.push('/')}
            className="w-full py-2 px-4 bg-gray-800 hover:bg-gray-700 rounded-lg flex items-center gap-2 text-gray-300 text-sm transition-colors"
          >
            <Home size={16} /> 홈으로
          </button>
          <button 
            onClick={startNewChat}
            className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 rounded-lg flex items-center gap-2 text-white font-medium transition-colors"
          >
            <Plus size={18} /> 새 대화
          </button>
        </div>

        {/* 대화 목록 - 스크롤 가능 */}
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

        {/* 사이드바 하단 - 고정 */}
        <div className="p-3 border-t border-gray-800 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400 truncate">{session.user?.name}</span>
            <button onClick={handleLogout} className="text-gray-500 hover:text-white">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 헤더 - 고정 */}
        <div className="h-14 border-b border-gray-800 flex items-center px-4 gap-3 flex-shrink-0">
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

        {/* 채팅 영역 - 스크롤 가능 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <div className="w-16 h-16 bg-purple-600/20 rounded-2xl flex items-center justify-center mb-6">
                <Bot size={32} className="text-purple-400" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">무엇을 도와드릴까요?</h2>
              <p className="text-gray-400 max-w-md">
                포트폴리오사의 지분율, 계약서, 재무제표, 위키 문서 등을 검색하고 분석해드립니다.
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {['Ruckus 지분율', 'Antistatic 계약서', 'PCF 위키 문서'].map(q => (
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
            <div className="max-w-4xl mx-auto py-6 px-4">
              {messages.map((m, i) => (
                <div 
                  key={i} 
                  className={`flex gap-4 mb-6 ${m.role === 'user' ? 'justify-end' : ''}`}
                  onMouseEnter={() => setHoveredMessageIndex(i)}
                  onMouseLeave={() => setHoveredMessageIndex(null)}
                >
                  {m.role === 'assistant' && (
                    <div className="w-8 h-8 bg-purple-600 rounded-lg flex-shrink-0 flex items-center justify-center">
                      <Bot size={18} className="text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] relative ${m.role === 'user' ? 'bg-blue-600 rounded-2xl px-4 py-3' : ''}`}>
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
                    {/* 시간 표시 - 호버 시 */}
                    {hoveredMessageIndex === i && m.timestamp && (
                      <div className={`absolute ${m.role === 'user' ? 'right-0' : 'left-0'} -bottom-5 text-xs text-gray-500 whitespace-nowrap`}>
                        {formatTime(m.timestamp)}
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
                  <div className="bg-[#1c2128] rounded-2xl px-4 py-3 border border-gray-700">
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-sm text-gray-300">{statusMessage}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 입력창 - 하단 고정 */}
        <div className="border-t border-gray-800 p-4 flex-shrink-0 bg-[#0b0e14]">
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
