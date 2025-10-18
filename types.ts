export interface Message {
  sender: 'user' | 'ai';
  text: string;
  image?: string;
  sources?: { uri: string; title: string }[];
}

export type View = 'chat' | 'image' | 'video' | 'live';
