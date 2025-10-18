import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Message } from '../types';
import Spinner from './Spinner';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
  };
};

const CHAT_HISTORY_KEY = 'ruchit-chat-history';
const SYSTEM_INSTRUCTION_KEY = 'ruchit-system-instruction';

const ChatView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const storedMessages = localStorage.getItem(CHAT_HISTORY_KEY);
      if (storedMessages) {
        return JSON.parse(storedMessages);
      }
    } catch (error) {
      console.error("Failed to parse chat history from localStorage", error);
    }
    return [{ sender: 'ai', text: "Hello! I'm Ruchit, your all-in-one AI assistant. How can I help you today?" }];
  });

  const [prompt, setPrompt] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systemInstruction, setSystemInstruction] = useState(() => localStorage.getItem(SYSTEM_INSTRUCTION_KEY) || '');
  const [isBoosting, setIsBoosting] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any | null>(null);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages));
      localStorage.setItem(SYSTEM_INSTRUCTION_KEY, systemInstruction);
    } catch (error) {
      console.error("Failed to save chat history to localStorage", error);
    }
  }, [messages, systemInstruction]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      
      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result) => result.transcript)
          .join('');
        setPrompt(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setError(`Speech recognition error: ${event.error}`);
        setIsListening(false);
      };
    }
  }, []);

  const handleToggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
    setIsListening(!isListening);
  };
  
  const handleSendMessage = async () => {
    if ((!prompt.trim() && !imageFile) || isLoading || isBoosting) return;

    setError(null);
    setIsLoading(true);
    const userMessage: Message = { sender: 'user', text: prompt };
    if (imageFile) {
        userMessage.image = URL.createObjectURL(imageFile);
    }
    setMessages(prev => [...prev, userMessage]);
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const model = useWebSearch ? 'gemini-2.5-flash' : 'gemini-2.5-pro';
      
      const contents = [];
      if (imageFile) {
        const imagePart = await fileToGenerativePart(imageFile);
        contents.push(imagePart);
      }
      contents.push({ text: prompt });

      const config: any = {};
      if (systemInstruction.trim()) {
          config.systemInstruction = systemInstruction.trim();
      }
      if (useWebSearch) {
          config.tools = [{ googleSearch: {} }];
      }

      const response = await ai.models.generateContent({
        model: model,
        contents: { parts: contents },
        ...(Object.keys(config).length > 0 && { config: config })
      });
      
      const aiResponseText = response.text;
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const sources = groundingChunks
        ?.map((chunk: any) => chunk.web)
        .filter(Boolean)
        .map((web: any) => ({ uri: web.uri, title: web.title })) || [];

      setMessages(prev => [...prev, { sender: 'ai', text: aiResponseText, sources: sources.length > 0 ? sources : undefined }]);

    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Sorry, an unexpected error occurred. Please try again.');
      setMessages(prev => prev.slice(0, -1)); // remove user message on error
    } finally {
      setIsLoading(false);
      setPrompt('');
      setImageFile(null);
      if(fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePromptBoost = async () => {
    if (!prompt.trim() || isBoosting || isLoading) return;
    setIsBoosting(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Rewrite this prompt to be more detailed and effective for an AI assistant: "${prompt}"`,
      });
      setPrompt(response.text);
    } catch (e: any) {
      console.error("Prompt boost failed", e);
      setError(e.message || 'Failed to boost prompt.');
    } finally {
      setIsBoosting(false);
    }
  };

  const handleNewChat = () => {
    setMessages([{ sender: 'ai', text: "Hello! I'm Ruchit, your all-in-one AI assistant. How can I help you today?" }]);
    setSystemInstruction('');
    localStorage.removeItem(CHAT_HISTORY_KEY);
    localStorage.removeItem(SYSTEM_INSTRUCTION_KEY);
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="p-4 border-b border-gray-700 flex justify-between items-center">
        <div className="w-8"></div>
        <h2 className="text-xl font-semibold text-center">AI Chat & Search</h2>
        <button onClick={handleNewChat} className="p-2 rounded-full hover:bg-gray-700 transition-colors" title="New Chat">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
      <div className="p-4 border-b border-gray-700">
        <label htmlFor="system-instruction" className="text-sm font-medium text-gray-400">System Instruction (Optional)</label>
        <input
          id="system-instruction"
          type="text"
          value={systemInstruction}
          onChange={(e) => setSystemInstruction(e.target.value)}
          placeholder="e.g., You are a master storyteller for children."
          className="w-full bg-gray-800 mt-1 p-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg, index) => (
          <div key={index} className={`flex gap-4 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.sender === 'ai' && <div className="w-8 h-8 bg-purple-600 rounded-full flex-shrink-0"></div>}
            <div className={`max-w-xl p-4 rounded-2xl ${msg.sender === 'user' ? 'bg-indigo-600 rounded-br-none' : 'bg-gray-700 rounded-bl-none'}`}>
              {msg.image && <img src={msg.image} alt="User upload" className="rounded-lg mb-2 max-h-60" />}
              <p className="whitespace-pre-wrap">{msg.text}</p>
               {msg.sources && msg.sources.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-600">
                  <h4 className="text-xs font-semibold text-gray-400 mb-2">Sources:</h4>
                  <div className="flex flex-col space-y-1">
                    {msg.sources.map((source, i) => (
                      <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-400 hover:underline truncate">
                        {i + 1}. {source.title || source.uri}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
         {isLoading && (
            <div className="flex justify-start gap-4">
               <div className="w-8 h-8 bg-purple-600 rounded-full flex-shrink-0"></div>
                <div className="p-4 rounded-2xl bg-gray-700 rounded-bl-none flex items-center">
                    <Spinner size="sm" />
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-700 bg-gray-800">
        {imageFile && (
            <div className="mb-2 flex items-center bg-gray-700 p-2 rounded-lg">
                <p className="text-sm text-gray-300 truncate flex-1">Attached: {imageFile.name}</p>
                <button onClick={() => { setImageFile(null); if(fileInputRef.current) fileInputRef.current.value = ''; }} className="ml-2 text-gray-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
        )}
        <div className="flex items-center bg-gray-700 rounded-xl p-2">
            <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-white transition-colors" title="Attach Image">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
            </button>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={(e) => setImageFile(e.target.files?.[0] || null)} className="hidden" />
            
            <button onClick={handlePromptBoost} disabled={isBoosting || !prompt.trim()} className="p-2 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors" title="Boost Prompt">
              {isBoosting ? <Spinner size="sm" /> : <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4m-2 2l-1.5-1.5M19 21v-4m2 2h-4m2-2l1.5 1.5M12 3v2m-1-1l-1 1m2 0l1 1m0 0l1-1m-2 18v-2m1 1l1-1m-2 0l-1-1m0 0l-1 1m16-7h-2m1 1l1-1m-2 0l-1-1m0 0l-1 1M4 12H2m1-1l-1 1m2 0l1 1m0 0l-1-1" /></svg>}
            </button>
            
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (error) setError(null);
              }}
              onKeyPress={handleKeyPress}
              placeholder="Ask anything or describe an image..."
              className="flex-1 bg-transparent focus:outline-none resize-none px-4 text-white"
              rows={1}
            />
            
            {recognitionRef.current && (
              <button onClick={handleToggleListening} className={`p-2 transition-colors rounded-full ${isListening ? 'text-red-500 bg-red-900/50' : 'text-gray-400 hover:text-white'}`} title={isListening ? 'Stop listening' : 'Use microphone'}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
              </button>
            )}

            <button
              onClick={handleSendMessage}
              disabled={isLoading || isBoosting || isListening || (!prompt.trim() && !imageFile)}
              className="p-2 ml-2 rounded-full bg-indigo-600 text-white disabled:bg-gray-500 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
              title="Send Message"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
            </button>
        </div>
        {error && (
            <p className="mt-2 text-sm text-red-400 text-center">{error}</p>
        )}
        <div className="flex items-center justify-end mt-2">
            <label htmlFor="web-search-toggle" className="text-sm text-gray-400 mr-2 cursor-pointer">Web Access</label>
            <button
              id="web-search-toggle"
              role="switch"
              aria-checked={useWebSearch}
              onClick={() => setUseWebSearch(!useWebSearch)} 
              className={`${useWebSearch ? 'bg-purple-600' : 'bg-gray-600'} relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-purple-500`}
            >
                <span className={`${useWebSearch ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}/>
            </button>
        </div>
      </div>
    </div>
  );
};

export default ChatView;