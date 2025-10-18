
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import Spinner from './Spinner';

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


const LiveChatView: React.FC = () => {
    const [isConnecting, setIsConnecting] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transcription, setTranscription] = useState<{user: string, ai: string}[]>([]);
    const [currentTurn, setCurrentTurn] = useState({ user: '', ai: '' });
    const [isSpeechEnabled, setIsSpeechEnabled] = useState(true);
    
    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const audioResourcesRef = useRef<{
        inputAudioContext: AudioContext | null;
        outputAudioContext: AudioContext | null;
        mediaStream: MediaStream | null;
        scriptProcessor: ScriptProcessorNode | null;
        streamSource: MediaStreamAudioSourceNode | null;
        sources: Set<AudioBufferSourceNode>;
        nextStartTime: number;
    }>({ inputAudioContext: null, outputAudioContext: null, mediaStream: null, scriptProcessor: null, streamSource: null, sources: new Set(), nextStartTime: 0});
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcription, currentTurn]);

    const cleanupAudio = () => {
        const { scriptProcessor, streamSource, mediaStream, inputAudioContext, outputAudioContext, sources } = audioResourcesRef.current;
        if (scriptProcessor) scriptProcessor.disconnect();
        if (streamSource) streamSource.disconnect();
        if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
        if (inputAudioContext && inputAudioContext.state !== 'closed') inputAudioContext.close();
        if (outputAudioContext && outputAudioContext.state !== 'closed') outputAudioContext.close();
        sources.forEach(source => source.stop());
        
        audioResourcesRef.current = { inputAudioContext: null, outputAudioContext: null, mediaStream: null, scriptProcessor: null, streamSource: null, sources: new Set(), nextStartTime: 0 };
    };

    const handleDisconnect = () => {
      if (sessionPromiseRef.current) {
        sessionPromiseRef.current.then(session => session.close()).catch(console.error);
        sessionPromiseRef.current = null;
      }
      cleanupAudio();
      window.speechSynthesis.cancel();
      setIsConnected(false);
      setIsConnecting(false);
    };

    useEffect(() => {
      return () => handleDisconnect();
    }, []);

    const handleConnect = async () => {
        if (isConnected || isConnecting) return;
        setIsConnecting(true);
        setError(null);
        setTranscription([]);
        setCurrentTurn({ user: '', ai: '' });

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const inputCtx = new AudioContext({ sampleRate: 16000 });
            const outputCtx = new AudioContext({ sampleRate: 24000 });
            const outputNode = outputCtx.createGain();
            outputNode.connect(outputCtx.destination);
            
            audioResourcesRef.current = { ...audioResourcesRef.current, mediaStream: stream, inputAudioContext: inputCtx, outputAudioContext: outputCtx };
            
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    outputAudioTranscription: {},
                    inputAudioTranscription: {},
                },
                callbacks: {
                    onopen: () => {
                        console.log('Session opened');
                        setIsConnecting(false);
                        setIsConnected(true);
                        
                        const source = inputCtx.createMediaStreamSource(stream);
                        const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
                        audioResourcesRef.current.streamSource = source;
                        audioResourcesRef.current.scriptProcessor = scriptProcessor;
                        
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const int16 = new Int16Array(inputData.length);
                            for (let i = 0; i < inputData.length; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputCtx.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                       if (message.serverContent?.outputTranscription) {
                            setCurrentTurn(prev => ({ ...prev, ai: prev.ai + message.serverContent!.outputTranscription!.text }));
                        } else if (message.serverContent?.inputTranscription) {
                            setCurrentTurn(prev => ({ ...prev, user: prev.user + message.serverContent!.inputTranscription!.text }));
                        }
                        
                        if (message.serverContent?.turnComplete) {
                            setCurrentTurn(prev => {
                                if (prev.user.trim() || prev.ai.trim()) {
                                    if (isSpeechEnabled && prev.ai.trim()) {
                                        const utterance = new SpeechSynthesisUtterance(prev.ai);
                                        window.speechSynthesis.speak(utterance);
                                    }
                                    setTranscription(t => [...t, prev]);
                                }
                                return { user: '', ai: '' };
                            });
                        }

                        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                        if (audioData && outputCtx) {
                            const { sources, nextStartTime } = audioResourcesRef.current;
                            const newNextStartTime = Math.max(nextStartTime, outputCtx.currentTime);
                            const audioBuffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
                            const source = outputCtx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputNode);
                            source.addEventListener('ended', () => sources.delete(source));
                            source.start(newNextStartTime);
                            audioResourcesRef.current.nextStartTime = newNextStartTime + audioBuffer.duration;
                            sources.add(source);
                        }

                        if (message.serverContent?.interrupted) {
                            audioResourcesRef.current.sources.forEach(s => s.stop());
                            audioResourcesRef.current.sources.clear();
                            audioResourcesRef.current.nextStartTime = 0;
                            window.speechSynthesis.cancel();
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Session error', e);
                        setError(e.message || 'An unknown session error occurred.');
                        handleDisconnect();
                    },
                    onclose: () => {
                        console.log('Session closed');
                        handleDisconnect();
                    },
                },
            });
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to start session. Check microphone permissions.');
            handleDisconnect();
        }
    };
    
    return (
        <div className="flex flex-col h-full bg-gray-900">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="text-xl font-semibold">Live Chat</h2>
              <div className="flex items-center gap-4">
                 <button onClick={() => setIsSpeechEnabled(!isSpeechEnabled)} className={`p-2 rounded-full transition-colors ${isSpeechEnabled ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`} title={isSpeechEnabled ? 'Disable Speech' : 'Enable Speech'}>
                    {isSpeechEnabled ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 2a6 6 0 00-6 6v3.586l-1.707 1.707A1 1 0 003 15v1a1 1 0 001 1h12a1 1 0 001-1v-1a1 1 0 00-.293-.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    )}
                 </button>
                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
                <span className="text-sm">{isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {transcription.map((turn, index) => (
                  <div key={index}>
                      <div className="flex justify-end"><p className="bg-indigo-600 p-3 rounded-2xl rounded-br-none max-w-xl">{turn.user}</p></div>
                      {turn.ai && <div className="flex justify-start mt-2"><p className="bg-gray-700 p-3 rounded-2xl rounded-bl-none max-w-xl">{turn.ai}</p></div>}
                  </div>
              ))}
              {(currentTurn.user || currentTurn.ai) && (
                  <div>
                      {currentTurn.user && <div className="flex justify-end"><p className="bg-indigo-600 p-3 rounded-2xl rounded-br-none max-w-xl opacity-70">{currentTurn.user}</p></div>}
                      {currentTurn.ai && <div className="flex justify-start mt-2"><p className="bg-gray-700 p-3 rounded-2xl rounded-bl-none max-w-xl opacity-70">{currentTurn.ai}</p></div>}
                  </div>
              )}
               {!isConnected && !isConnecting && transcription.length === 0 && (
                <div className="text-center text-gray-500 pt-20">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  <p>Start a live conversation with the AI.</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <div className="p-4 border-t border-gray-700 bg-gray-800">
                {error && <p className="text-sm text-red-400 text-center mb-3">{error}</p>}
                {!isConnected ? (
                    <button onClick={handleConnect} disabled={isConnecting} className="w-full py-3 px-4 bg-purple-600 rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center">
                        {isConnecting ? <Spinner size="sm"/> : 'Start Session'}
                    </button>
                ) : (
                    <button onClick={handleDisconnect} className="w-full py-3 px-4 bg-red-600 rounded-lg font-semibold hover:bg-red-700 transition-colors flex items-center justify-center">
                        Stop Session
                    </button>
                )}
            </div>
        </div>
    );
};

export default LiveChatView;