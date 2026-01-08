// ... (위쪽 코드는 동일)

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

      // 🔍 에러 방지 로직 추가: 답변 데이터가 정상인지 확인
      if (data && data.content && data.content[0] && data.content[0].text) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.content[0].text }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `에러 발생: ${data.error}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: '답변을 가져오지 못했습니다. API 설정을 확인해주세요.' }]);
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages(prev => [...prev, { role: 'assistant', content: '서버 연결에 실패했습니다. 다시 시도해주세요.' }]);
    } finally {
      setIsLoading(false);
    }
  };

// ... (아래쪽 코드는 동일)
