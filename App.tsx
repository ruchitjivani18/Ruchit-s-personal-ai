import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import ImageView from './components/ImageView';
import VideoView from './components/VideoView';
import LiveChatView from './components/LiveChatView';
import { View } from './types';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<View>('chat');

  const renderView = () => {
    switch (currentView) {
      case 'chat':
        return <ChatView />;
      case 'image':
        return <ImageView />;
      case 'video':
        return <VideoView />;
      case 'live':
        return <LiveChatView />;
      default:
        return <ChatView />;
    }
  };

  return (
    <div className="flex h-screen w-screen bg-gray-900 text-white">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      <main className="flex-1">
        {renderView()}
      </main>
    </div>
  );
};

export default App;
