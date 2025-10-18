

import React, { useState, useEffect } from 'react';
import { GoogleGenAI, Operation } from '@google/genai';
import Spinner from './Spinner';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}

interface GeneratedVideo {
    url: string;
    operation: Operation<any>;
    prompt: string;
}

const VideoView: React.FC = () => {
    const [prompt, setPrompt] = useState('');
    const [extendPrompt, setExtendPrompt] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isExtending, setIsExtending] = useState(false);
    const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [progressMessage, setProgressMessage] = useState('');
    const [apiKeySelected, setApiKeySelected] = useState(false);
    const [extendDuration, setExtendDuration] = useState<number>(7);
    const [isDroneShot, setIsDroneShot] = useState(false);

    const checkApiKey = async () => {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            setApiKeySelected(hasKey);
        }
    };

    useEffect(() => {
        checkApiKey();
    }, []);

    const handleSelectKey = async () => {
        if (window.aistudio) {
            await window.aistudio.openSelectKey();
            // Assuming key selection is successful to avoid race conditions.
            setApiKeySelected(true);
        }
    };
    
    const handleApiError = (err: any) => {
        console.error(err);
        let errorMessage = 'An unexpected error occurred.';
        if (err && err.message) {
            errorMessage = String(err.message);
        } else if (err) {
            errorMessage = String(err);
        }

        if (errorMessage.includes("Requested entity was not found.")) {
            errorMessage = "API Key not found or invalid. Please ensure your project has billing enabled and select a valid key.";
            setApiKeySelected(false);
        }
        setError(errorMessage);
    }

    const pollOperation = async (operation: Operation<any>): Promise<Operation<any>> => {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
        while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }
        return operation;
    };

    const processVideoLink = async (downloadLink: string): Promise<string> => {
        setProgressMessage('Fetching video...');
        const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
        if (!response.ok) {
            throw new Error(`Failed to download video: ${response.statusText}`);
        }
        const videoBlob = await response.blob();
        return URL.createObjectURL(videoBlob);
    };

    const handleGenerate = async () => {
        if (!prompt || !apiKeySelected) return;

        setIsLoading(true);
        setGeneratedVideos([]);
        setError(null);
        setProgressMessage('Starting video generation...');
        
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const finalPrompt = isDroneShot ? `A cinematic 3D drone shot of ${prompt}` : prompt;

            setProgressMessage('Sending request to model. This can take minutes...');
            let op = await ai.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt: finalPrompt,
                config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
            });

            setProgressMessage('Waiting for video to be processed...');
            op = await pollOperation(op);

            if (op.error) throw op.error;

            const link = op.response?.generatedVideos?.[0]?.video?.uri;
            if (link) {
                const videoUrl = await processVideoLink(link);
                setGeneratedVideos([{ url: videoUrl, operation: op, prompt: finalPrompt }]);
            } else {
                throw new Error('Video generation did not return a valid link.');
            }

        } catch (err: any) {
            handleApiError(err);
        } finally {
            setIsLoading(false);
            setProgressMessage('');
        }
    };

    const handleExtend = async () => {
        if (!extendPrompt || generatedVideos.length === 0) return;
        
        setIsExtending(true);
        setError(null);
        setProgressMessage('Extending video...');
        
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const extensionsToRun = extendDuration === 15 ? 2 : 1;
            // Get the last video from the state to start the extension chain
            let lastVideoOperation = generatedVideos[generatedVideos.length - 1].operation;
            const newVideos: GeneratedVideo[] = [];

            for (let i = 0; i < extensionsToRun; i++) {
                setProgressMessage(`Sending extend request (${i + 1}/${extensionsToRun}). This may take a few minutes...`);
                
                let op = await ai.models.generateVideos({
                    model: 'veo-3.1-generate-preview',
                    prompt: extendPrompt,
                    video: lastVideoOperation.response?.generatedVideos?.[0]?.video,
                    config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
                });

                setProgressMessage(`Waiting for extended video to process (${i + 1}/${extensionsToRun})...`);
                op = await pollOperation(op);

                if (op.error) throw op.error;

                const link = op.response?.generatedVideos?.[0]?.video?.uri;
                if (link) {
                    const newVideoUrl = await processVideoLink(link);
                    const promptSuffix = extensionsToRun > 1 ? ` (part ${i + 1})` : '';
                    const newVideo: GeneratedVideo = { 
                        url: newVideoUrl, 
                        operation: op, 
                        prompt: `${extendPrompt}${promptSuffix}` 
                    };
                    newVideos.push(newVideo);
                    lastVideoOperation = op; // Use the new operation for the next iteration
                } else {
                    throw new Error(`Video extension (part ${i + 1}) did not return a valid link.`);
                }
            }
            
            setGeneratedVideos(prev => [...prev, ...newVideos]);
            setExtendPrompt('');

        } catch (err: any) {
            handleApiError(err);
        } finally {
            setIsExtending(false);
            setProgressMessage('');
        }
    };

    const renderContent = () => {
        if (!apiKeySelected) {
            return (
                <div className="text-center p-8 bg-gray-800 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">API Key Required for Video Generation</h3>
                    <p className="text-gray-400 mb-6">The Veo model requires you to select a project with billing enabled.</p>
                    <button onClick={handleSelectKey} className="py-2 px-4 bg-purple-600 rounded-lg font-semibold hover:bg-purple-700 transition-colors">
                        Select API Key
                    </button>
                    <p className="text-xs text-gray-500 mt-4">
                        For more info, see the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-400">billing documentation</a>.
                    </p>
                </div>
            );
        }

        if (isLoading || isExtending) {
            return (
                <div className="flex flex-col items-center justify-center text-center">
                    <Spinner size="lg" />
                    <p className="mt-4 text-lg">{progressMessage}</p>
                    <p className="text-gray-400 mt-2">Please be patient, this can take several minutes.</p>
                </div>
            );
        }

        if (error) {
            return (
                <div className="text-red-400 text-center max-w-md p-4 bg-red-900/20 rounded-lg">
                    <h3 className="font-bold mb-2">Video Generation Failed</h3>
                    <p>{error}</p>
                </div>
            );
        }

        if (generatedVideos.length > 0) {
            const latestVideo = generatedVideos[generatedVideos.length - 1];
            return (
                <div className="w-full max-w-4xl">
                    <video src={latestVideo.url} controls autoPlay loop className="w-full max-h-[65vh] rounded-lg shadow-2xl bg-black" />
                    <div className="mt-4 text-center">
                         <a 
                            href={latestVideo.url} 
                            download={`ruchit-ai-video-step-${generatedVideos.length}.mp4`}
                            className="inline-block py-2 px-6 bg-green-600 rounded-lg font-semibold hover:bg-green-700 transition-colors"
                        >
                            Download Latest Video
                        </a>
                    </div>
                    {generatedVideos.length > 1 && (
                        <div className="mt-6 pt-4 border-t border-gray-700">
                            <h4 className="text-lg font-semibold mb-3 text-center">Video History</h4>
                            <ul className="space-y-2 max-h-48 overflow-y-auto">
                                {generatedVideos.slice(0, -1).map((video, index) => (
                                    <li key={index} className="flex justify-between items-center bg-gray-800 p-3 rounded-lg">
                                        <div className="flex-1 overflow-hidden">
                                            <p className="font-semibold">{index === 0 ? 'Initial Generation' : `Extension ${index}`}</p>
                                            <p className="text-xs text-gray-400 truncate">Prompt: "{video.prompt}"</p>
                                        </div>
                                        <a href={video.url} download={`ruchit-ai-video-step-${index + 1}.mp4`} className="ml-4 flex-shrink-0 py-1 px-3 bg-indigo-600 rounded-md text-sm hover:bg-indigo-700">
                                            Download
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            );
        }

        return <div className="text-gray-500">Your generated video will appear here.</div>;
    };
    
    const canExtend = generatedVideos.length > 0;

    return (
        <div className="flex flex-col h-full bg-gray-900">
            <div className="p-4 border-b border-gray-700 text-center">
                <h2 className="text-xl font-semibold">Video Studio</h2>
            </div>
            <div className="flex-1 flex md:flex-row flex-col">
                <div className="md:w-1/3 w-full p-6 bg-gray-800 border-r border-gray-700 overflow-y-auto">
                    <h3 className="text-lg font-semibold mb-3">Generate Video</h3>
                    <textarea
                        value={prompt}
                        onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
                        placeholder="e.g., A robot DJing at a party on Mars"
                        className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                        rows={4}
                        disabled={!apiKeySelected}
                    />
                     <div className="flex items-center justify-end mt-2">
                        <label htmlFor="drone-shot-toggle" className="text-sm text-gray-400 mr-2 cursor-pointer">Cinematic Drone Shot Style</label>
                        <button
                          id="drone-shot-toggle"
                          role="switch"
                          aria-checked={isDroneShot}
                          onClick={() => setIsDroneShot(!isDroneShot)} 
                          className={`${isDroneShot ? 'bg-purple-600' : 'bg-gray-600'} relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-purple-500`}
                          disabled={!apiKeySelected}
                        >
                            <span className={`${isDroneShot ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}/>
                        </button>
                    </div>
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading || isExtending || !prompt || !apiKeySelected}
                        className="w-full mt-3 py-3 px-4 bg-purple-600 rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isLoading ? <Spinner size="sm" /> : 'Generate New Video'}
                    </button>

                    {canExtend && (
                        <div className="mt-6 border-t border-gray-600 pt-6">
                            <h3 className="text-lg font-semibold mb-3">Extend Video</h3>
                             <textarea
                                value={extendPrompt}
                                onChange={(e) => setExtendPrompt(e.target.value)}
                                placeholder="e.g., something unexpected happens..."
                                className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                                rows={2}
                            />
                            <div className="mt-3">
                                <label htmlFor="duration-select" className="block mb-2 text-sm font-medium text-gray-300">Extension Duration</label>
                                <select 
                                    id="duration-select"
                                    value={extendDuration} 
                                    onChange={e => setExtendDuration(Number(e.target.value))} 
                                    className="w-full bg-gray-700 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value={7}>~7 seconds</option>
                                    <option value={15}>~15 seconds</option>
                                </select>
                                <p className="text-xs text-gray-500 mt-2">
                                    Longer extensions are achieved by chaining multiple shorter extensions.
                                </p>
                            </div>
                            <button
                                onClick={handleExtend}
                                disabled={isExtending || isLoading || !extendPrompt}
                                className="w-full mt-3 py-3 px-4 bg-indigo-600 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
                            >
                                {isExtending ? <Spinner size="sm" /> : 'Extend Video'}
                            </button>
                        </div>
                    )}
                     {error && !isLoading && !isExtending && apiKeySelected && <p className="mt-4 text-sm text-red-400 text-center">{error}</p>}
                </div>

                <div className="flex-1 p-6 flex items-center justify-center bg-gray-900 overflow-auto">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export default VideoView;