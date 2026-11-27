import { create } from 'zustand';
import type { BreadcrumbItem } from '../components/ui';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_SIDEBAR_KEY = 'atlas.ui.sidebarCollapsed';
const STORAGE_RIGHT_WIDTH_KEY = 'atlas.ui.rightPanelWidth';

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val === 'true';
  } catch {
    return fallback;
  }
}

function loadNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  } catch {
    return fallback;
  }
}

interface RoadmapViewportState {
  selectedPathId: string;
  selectedNodeId: string | null;
  viewport: { x: number; y: number; zoom: number } | null;
  viewMode: 'graph' | 'list';
  onlyRequired: boolean;
  focusedStageId: string | null;
}

interface AppState {
  theme: ThemePreference;
  readerWidthPx: number;
  fontSizePx: number;
  reducedMotion: boolean;
  sidebarCollapsed: boolean;
  rightPanelWidth: number;
  pageBreadcrumb: BreadcrumbItem[] | null;
  commandOpen: boolean;
  tutorOpen: boolean;
  tutorContextNodeId: string | null;
  dataVersion: number;
  roadmap: RoadmapViewportState;

  setTheme: (theme: ThemePreference) => void;
  setReaderPrefs: (prefs: Partial<{ readerWidthPx: number; fontSizePx: number; reducedMotion: boolean }>) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setRightPanelWidth: (w: number) => void;
  setPageBreadcrumb: (items: BreadcrumbItem[] | null) => void;
  setCommandOpen: (v: boolean) => void;
  openTutor: (nodeId?: string | null) => void;
  setTutorOpen: (v: boolean) => void;
  setTutorContextNodeId: (id: string | null) => void;
  bumpDataVersion: () => void;
  updateRoadmap: (patch: Partial<RoadmapViewportState>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  theme: 'system',
  readerWidthPx: 760,
  fontSizePx: 16,
  reducedMotion: false,
  sidebarCollapsed: loadBool(STORAGE_SIDEBAR_KEY, false),
  rightPanelWidth: loadNumber(STORAGE_RIGHT_WIDTH_KEY, 340, 280, 560),
  pageBreadcrumb: null,
  commandOpen: false,
  tutorOpen: false,
  tutorContextNodeId: null,
  dataVersion: 0,
  roadmap: {
    selectedPathId: 'agent-foundations',
    selectedNodeId: null,
    viewport: null,
    viewMode: 'list',
    onlyRequired: false,
    focusedStageId: null,
  },

  setTheme: (theme) => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    set({ theme });
  },

  setReaderPrefs: (prefs) =>
    set((state) => {
      const next = {
        readerWidthPx: prefs.readerWidthPx ?? state.readerWidthPx,
        fontSizePx: prefs.fontSizePx ?? state.fontSizePx,
        reducedMotion: prefs.reducedMotion ?? state.reducedMotion,
      };
      const root = document.documentElement;
      root.style.setProperty('--reader-width', `${next.readerWidthPx}px`);
      root.style.setProperty('--reader-font-size', `${next.fontSizePx}px`);
      root.setAttribute('data-reduced-motion', String(next.reducedMotion));
      return next;
    }),

  setSidebarCollapsed: (sidebarCollapsed) => {
    try {
      localStorage.setItem(STORAGE_SIDEBAR_KEY, String(sidebarCollapsed));
    } catch {
      // ignore storage failure
    }
    set({ sidebarCollapsed });
  },

  setRightPanelWidth: (w) => {
    const clamped = Math.min(560, Math.max(280, Math.round(w)));
    try {
      localStorage.setItem(STORAGE_RIGHT_WIDTH_KEY, String(clamped));
    } catch {
      // ignore storage failure
    }
    set({ rightPanelWidth: clamped });
  },

  setPageBreadcrumb: (pageBreadcrumb) => set({ pageBreadcrumb }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  openTutor: (nodeId) =>
    set((state) => ({
      tutorOpen: true,
      tutorContextNodeId: nodeId !== undefined ? nodeId : state.tutorContextNodeId,
    })),
  setTutorOpen: (tutorOpen) => set({ tutorOpen }),
  setTutorContextNodeId: (tutorContextNodeId) => set({ tutorContextNodeId }),
  bumpDataVersion: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  updateRoadmap: (patch) =>
    set((state) => ({
      roadmap: { ...state.roadmap, ...patch },
    })),
}));
