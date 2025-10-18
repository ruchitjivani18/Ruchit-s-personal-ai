
import React, { useState, useRef } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import Spinner from './Spinner';

type ImageMode = 'generate' | 'edit' | 'faceswap' | 'template';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });
};

const templates = [
  {
    id: 'neon-punk',
    name: 'Neon Punk',
    prompt: 'Transform this photo into a vibrant, neon-punk style, with glowing pink and blue highlights, and a gritty, futuristic cyberpunk aesthetic.',
  },
  {
    id: 'vintage-film',
    name: 'Vintage Film',
    prompt: 'Apply a vintage film effect to this image, with faded colors, soft grain, and light leaks, reminiscent of a 1970s photograph.',
  },
  {
    id: 'watercolor',
    name: 'Watercolor',
    prompt: 'Convert this image into a beautiful watercolor painting, with soft, blended colors and visible brush strokes on a textured paper background.',
  },
  {
    id: '3d-cartoon',
    name: '3D Cartoon',
    prompt: 'Reimagine this photo as a modern 3D cartoon character or scene, with smooth, exaggerated features and vibrant, playful lighting.',
  },
   {
    id: 'gothic-noir',
    name: 'Gothic Noir',
    prompt: 'Give this image a gothic noir treatment. Make it black and white with high contrast, deep shadows, and a mysterious, dramatic atmosphere.',
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    prompt: "Enhance this photo to look like it was taken during the 'golden hour'. Add warm, soft, glowing light, long shadows, and a dreamy, magical feel.",
  },
];


const ImageView: React.FC = () => {
  const [mode, setMode] = useState<ImageMode>('generate');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [numberOfImages, setNumberOfImages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customTemplatePrompt, setCustomTemplatePrompt] = useState('');

  // State for results
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [editedImageResult, setEditedImageResult] = useState<string | null>(null);
  
  // State for edit/tool inputs
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [faceSwapFile, setFaceSwapFile] = useState<File | null>(null);
  const [faceSwapPreview, setFaceSwapPreview] = useState<string | null>(null);
  
  const imageFileRef = useRef<HTMLInputElement>(null);
  const faceSwapFileRef = useRef<HTMLInputElement>(null);

  const resetOutputs = () => {
    setGeneratedImages([]);
    setEditedImageResult(null);
    setError(null);
  };
  
  const handleModeChange = (newMode: ImageMode) => {
    setMode(newMode);
    resetOutputs();
    setPrompt('');
    setImageFile(null);
    setImagePreview(null);
    setFaceSwapFile(null);
    setFaceSwapPreview(null);
    setCustomTemplatePrompt('');
    if(imageFileRef.current) imageFileRef.current.value = '';
    if(faceSwapFileRef.current) faceSwapFileRef.current.value = '';
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'main' | 'face') => {
    const file = e.target.files?.[0];
    if (file) {
      if (type === 'main') {
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
      } else {
        setFaceSwapFile(file);
        setFaceSwapPreview(URL.createObjectURL(file));
      }
      resetOutputs();
    }
  };
  
  const handleGenerate = async () => {
    if (!prompt) return;
    setIsLoading(true);
    resetOutputs();
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const response = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: {
          numberOfImages: numberOfImages,
          outputMimeType: 'image/jpeg',
          aspectRatio: aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
        },
      });
      const images = response.generatedImages.map(img => `data:image/jpeg;base64,${img.image.imageBytes}`);
      setGeneratedImages(images);
    } catch (error: any) {
      console.error(error);
      setError(error.message || 'Failed to generate image. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const performImageAction = async (modelPrompt: string, files: {file: File, role: string}[]) => {
      setIsLoading(true);
      resetOutputs();
      try {
          const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
          const parts: any[] = [];
          for (const { file } of files) {
              const base64Data = await fileToBase64(file);
              parts.push({ inlineData: { data: base64Data, mimeType: file.type } });
          }
          parts.push({ text: modelPrompt });
          
          const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: { parts },
              config: { responseModalities: [Modality.IMAGE] },
          });

          for (const part of response.candidates[0].content.parts) {
              if (part.inlineData) {
                  const base64ImageBytes: string = part.inlineData.data;
                  setEditedImageResult(`data:image/png;base64,${base64ImageBytes}`);
                  break;
              }
          }
      } catch (error: any) {
          console.error(error);
          setError(error.message || 'Failed to process image. Please try again.');
      } finally {
          setIsLoading(false);
      }
  };
  
  const handleEdit = () => performImageAction(prompt, [{ file: imageFile!, role: 'input' }]);
  const handleFaceSwap = () => performImageAction(
      'In the first image (the base), swap the most prominent face with the face from the second image.',
      [{ file: imageFile!, role: 'base' }, { file: faceSwapFile!, role: 'face' }]
  );
  const handleApplyTemplate = (templatePrompt: string) => performImageAction(templatePrompt, [{ file: imageFile!, role: 'input' }]);

  const renderControls = () => {
    switch(mode) {
      case 'generate':
        return (
          <div>
            <h3 className="text-lg font-semibold mb-3">Generate Image</h3>
            <div className="flex gap-4 mb-4">
              <div className="flex-1">
                <label className="block mb-2 text-sm font-medium text-gray-300">Aspect Ratio</label>
                <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="w-full bg-gray-700 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value="1:1">Square (1:1)</option>
                    <option value="16:9">Landscape (16:9)</option>
                    <option value="9:16">Portrait (9:16)</option>
                    <option value="4:3">Standard (4:3)</option>
                    <option value="3:4">Tall (3:4)</option>
                </select>
              </div>
              <div className="flex-1">
                  <label className="block mb-2 text-sm font-medium text-gray-300"># of Images</label>
                <select value={numberOfImages} onChange={e => setNumberOfImages(Number(e.target.value))} className="w-full bg-gray-700 p-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
                    <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
              </div>
            </div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., A cinematic shot of a raccoon astronaut on Mars" className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={3}/>
            <button onClick={handleGenerate} disabled={isLoading || !prompt} className="w-full mt-3 py-3 px-4 bg-purple-600 rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center">
              {isLoading ? <Spinner size="sm" /> : 'Generate'}
            </button>
          </div>
        );
      case 'edit':
        return (
           <div>
            <h3 className="text-lg font-semibold mb-3">Edit Image</h3>
            <input type="file" accept="image/*" ref={imageFileRef} onChange={(e) => handleFileChange(e, 'main')} className="hidden"/>
            <button onClick={() => imageFileRef.current?.click()} className="w-full py-3 px-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-center mb-3">
                {imageFile ? `Selected: ${imageFile.name}` : "Upload Image"}
            </button>
             <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., Add a party hat, or erase the car" className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" rows={3}/>
            <button onClick={handleEdit} disabled={isLoading || !prompt || !imageFile} className="w-full mt-3 py-3 px-4 bg-purple-600 rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center">
              {isLoading ? <Spinner size="sm" /> : 'Apply Edit'}
            </button>
          </div>
        );
      case 'faceswap':
        return (
          <div>
              <h3 className="text-lg font-semibold mb-3">Face Swap</h3>
              <input type="file" accept="image/*" ref={imageFileRef} onChange={(e) => handleFileChange(e, 'main')} className="hidden"/>
              <button onClick={() => imageFileRef.current?.click()} className="w-full py-3 px-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-center mb-3">
                  {imageFile ? `Base: ${imageFile.name}` : "Upload Base Image"}
              </button>
              <input type="file" accept="image/*" ref={faceSwapFileRef} onChange={(e) => handleFileChange(e, 'face')} className="hidden"/>
              <button onClick={() => faceSwapFileRef.current?.click()} className="w-full py-3 px-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-center">
                  {faceSwapFile ? `Face: ${faceSwapFile.name}` : "Upload Face Image"}
              </button>
              <button onClick={handleFaceSwap} disabled={isLoading || !imageFile || !faceSwapFile} className="w-full mt-3 py-3 px-4 bg-purple-600 rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center">
                {isLoading ? <Spinner size="sm" /> : 'Swap Faces'}
              </button>
          </div>
        );
      case 'template':
        return (
          <div>
            <h3 className="text-lg font-semibold mb-3">Apply a Template or Filter</h3>
            <input type="file" accept="image/*" ref={imageFileRef} onChange={(e) => handleFileChange(e, 'main')} className="hidden"/>
            <button onClick={() => imageFileRef.current?.click()} className="w-full py-3 px-4 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors text-center mb-4">
                {imageFile ? `Selected: ${imageFile.name}` : "1. Upload Image"}
            </button>
            <h4 className={`text-md font-semibold mb-2 ${!imageFile ? 'text-gray-500' : ''}`}>2. Choose a Preset Style</h4>
             <div className="grid grid-cols-2 gap-2">
              {templates.map(template => (
                <button
                  key={template.id}
                  onClick={() => handleApplyTemplate(template.prompt)}
                  disabled={isLoading || !imageFile}
                  title={template.prompt}
                  className="p-3 bg-gray-700 rounded-lg text-sm font-medium hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                >
                  {template.name}
                </button>
              ))}
            </div>
             <div className="mt-4 pt-4 border-t border-gray-600">
              <h4 className={`text-md font-semibold mb-2 ${!imageFile ? 'text-gray-500' : ''}`}>3. Or Create Your Own Filter</h4>
              <textarea 
                value={customTemplatePrompt}
                onChange={(e) => setCustomTemplatePrompt(e.target.value)}
                placeholder="Describe any style... e.g., 'A dreamy, ethereal filter with soft focus and pastel colors.'"
                className="w-full bg-gray-700 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none disabled:bg-gray-800 disabled:text-gray-500"
                rows={3}
                disabled={!imageFile || isLoading}
              />
              <button
                onClick={() => handleApplyTemplate(customTemplatePrompt)}
                disabled={isLoading || !imageFile || !customTemplatePrompt.trim()}
                className="w-full mt-2 py-3 px-4 bg-indigo-600 rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
              >
                Apply Custom Filter
              </button>
            </div>
          </div>
        );
    }
  }
  
  const renderResults = () => {
    const isToolMode = mode === 'edit' || mode === 'faceswap' || mode === 'template';

    if (isLoading) return <Spinner size="lg"/>;
    if (error) return (
      <div className="text-red-400 text-center max-w-md p-4 bg-red-900/20 rounded-lg">
          <h3 className="font-bold mb-2">Image Operation Failed</h3>
          <p>{error}</p>
      </div>
    );

    if (mode === 'generate') {
      return generatedImages.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {generatedImages.map((imageSrc, index) => (
            <div key={index} className="relative group">
                <img src={imageSrc} alt={`Generated ${index + 1}`} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"/>
                <a href={imageSrc} download={`ruchit-ai-generated-${index + 1}.jpeg`} className="absolute bottom-2 right-2 bg-purple-600 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" title="Download Image">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </a>
            </div>
          ))}
        </div>
      ) : <div className="text-gray-500">Your generated image(s) will appear here.</div>;
    }
    
    if (isToolMode) {
      if (!imageFile) {
        return <div className="text-gray-500">Upload an image to start.</div>
      }
      return (
         <div className="flex flex-wrap gap-4 items-center justify-center w-full">
           {imagePreview && (
               <div className="flex flex-col items-center">
                   <h4 className="text-sm font-bold mb-2">{mode === 'faceswap' ? 'Base Image' : 'Original'}</h4>
                   <img src={imagePreview} alt="Original" className="max-w-sm max-h-96 object-contain rounded-lg shadow-lg"/>
               </div>
           )}
           {mode === 'faceswap' && faceSwapPreview && (
               <div className="flex flex-col items-center">
                   <h4 className="text-sm font-bold mb-2">Face Source</h4>
                   <img src={faceSwapPreview} alt="Face Source" className="max-w-sm max-h-96 object-contain rounded-lg shadow-lg"/>
               </div>
           )}
           {editedImageResult && (
                <div className="flex flex-col items-center">
                    <h4 className="text-sm font-bold mb-2">Result</h4>
                    <div className="relative group">
                        <img src={editedImageResult} alt="Edited" className="max-w-sm max-h-96 object-contain rounded-lg shadow-lg"/>
                        <a href={editedImageResult} download="ruchit-ai-edited.png" className="absolute bottom-2 right-2 bg-purple-600 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" title="Download Image">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        </a>
                    </div>
                </div>
           )}
        </div>
      );
    }

    return null;
  }
  
  const modeOptions: {id: ImageMode, label: string}[] = [
    {id: 'generate', label: 'Generate'},
    {id: 'edit', label: 'Edit'},
    {id: 'faceswap', label: 'Face Swap'},
    {id: 'template', label: 'Templates'},
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900">
        <div className="p-4 border-b border-gray-700 text-center">
            <h2 className="text-xl font-semibold">Image Studio</h2>
        </div>
        <div className="flex-1 flex md:flex-row flex-col">
            <div className="md:w-1/3 w-full p-6 bg-gray-800 border-r border-gray-700 overflow-y-auto">
                <div className="flex bg-gray-700 rounded-lg p-1 mb-6 flex-wrap">
                   {modeOptions.map(opt => (
                     <button key={opt.id} onClick={() => handleModeChange(opt.id)} className={`flex-grow py-2 px-1 rounded-md font-medium text-sm transition-colors ${mode === opt.id ? 'bg-purple-600' : 'hover:bg-gray-600'}`}>
                       {opt.label}
                     </button>
                   ))}
                </div>
                {renderControls()}
            </div>

            <div className="flex-1 p-6 flex items-center justify-center bg-gray-900 overflow-auto">
                {renderResults()}
            </div>
        </div>
    </div>
  );
};

export default ImageView;
