/// <reference types="vite/client" />

interface Window {
  miwebDesktop?: {
    selectProject(): Promise<string | null>;
    platform: string;
  };
}
