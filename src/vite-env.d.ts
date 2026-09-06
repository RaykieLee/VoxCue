/// <reference types="vite/client" />

interface Window {
  desktop?: {
    onShortcut?: (callback: () => void) => () => void
    onSessionShortcut?: (callback: () => void) => () => void
    orb: {
      action: (action: 'toggle' | 'send' | 'show-main') => void
      updateState: (state: Record<string, any>) => void
      onAction: (callback: (action: string) => void) => () => void
      onState: (callback: (state: any) => void) => () => void
    }
    setExpanded: (expanded: boolean) => void
    close: () => void
    settings: {
      get: () => Promise<Record<string, any>>
      set: (patch: Record<string, any>) => Promise<Record<string, any>>
      reset: () => Promise<Record<string, any>>
    }
    diagnostics: {
      check: () => Promise<{ models: boolean; modelFiles: number; modelTotal: number; voiceprint: boolean; shortcutRegistered: boolean; cdpReachable: boolean; platform: string; appVersion: string }>
      openSettings: (area: 'microphone' | 'privacy') => Promise<void>
    }
    models: {
      list: () => Promise<Array<Record<string, any>>>
      download: (id: string) => Promise<Record<string, any>>
      select: (type: 'asr' | 'vad' | 'speaker', id: string) => Promise<Record<string, any>>
    }
    cdp: {
      discover: (port: number) => Promise<any>
      launchChatGPT: (port: number) => Promise<any>
      connect: (port: number) => Promise<any>
      disconnect: () => Promise<any>
      write: (text: string, append?: boolean) => Promise<any>
      send: () => Promise<any>
      sessions: () => Promise<{ sessions: Array<{ id: string; title: string; href: string; current?: boolean }>; currentId: string | null; currentTitle: string }>
      switchSession: (id: string, href?: string) => Promise<{ sessions: Array<{ id: string; title: string; href: string; current?: boolean }>; currentId: string | null; currentTitle: string }>
      newSession: () => Promise<{ sessions: Array<{ id: string; title: string; href: string; current?: boolean }>; currentId: string | null; currentTitle: string }>
      snapshot: () => Promise<{ ok: boolean; currentId: string | null; title: string; latestUser?: string; latestReply?: string; replySummary?: string; capturedAt?: number }>
      onEvent: (callback: (event: any) => void) => () => void
    }
    speech: {
      start: (options?: any) => Promise<any>
      push: (samples: ArrayBufferLike) => Promise<any>
      command: (command: any) => Promise<any>
      clearSpeaker: () => Promise<any>
      stop: () => Promise<any>
      onEvent: (callback: (event: any) => void) => () => void
    }
  }
}
