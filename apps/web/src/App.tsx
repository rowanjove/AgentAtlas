import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { apiGet, ensureSessionToken } from './lib/api';
import { ThemePreference, useAppStore } from './store/useAppStore';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Skeleton, ToastViewport } from './components/ui';

const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const LearningPage = lazy(() => import('./pages/LearningPage').then((m) => ({ default: m.LearningPage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })));
const GlobalGraphPage = lazy(() => import('./pages/GlobalGraphPage').then((m) => ({ default: m.GlobalGraphPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const EcosystemPage = lazy(() => import('./pages/EcosystemPage').then((m) => ({ default: m.EcosystemPage })));
const CasebookPage = lazy(() => import('./pages/CasebookPage').then((m) => ({ default: m.CasebookPage })));
const MyLearningPage = lazy(() => import('./pages/MyLearningPage').then((m) => ({ default: m.MyLearningPage })));
const ContentPage = lazy(() => import('./pages/ContentPage').then((m) => ({ default: m.ContentPage })));
const TutorPage = lazy(() => import('./pages/TutorPage').then((m) => ({ default: m.TutorPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function RouteFallback() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-80" />
      <div className="grid sm:grid-cols-2 gap-4 pt-2">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

export function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setReaderPrefs = useAppStore((s) => s.setReaderPrefs);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) {
        return;
      }
      if (window.getSelection()?.toString().trim()) {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('contextmenu', onContextMenu, { capture: true });

    ensureSessionToken().catch(() => {});
    apiGet<{ theme: ThemePreference; readerWidthPx: number; fontSizePx: number; reducedMotion: boolean }>('/api/settings')
      .then((s) => {
        setTheme(s.theme);
        setReaderPrefs({
          readerWidthPx: s.readerWidthPx,
          fontSizePx: s.fontSizePx,
          reducedMotion: s.reducedMotion,
        });
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, [setTheme, setReaderPrefs]);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<OverviewPage />} />
              <Route path="/learn" element={<LearningPage />} />
              <Route path="/learn/:pathId" element={<LearningPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/library/graph" element={<GlobalGraphPage />} />
              <Route path="/library/:nodeId" element={<LibraryPage />} />
              <Route path="/lab" element={<PlaygroundPage />} />
              <Route path="/lab/:labId" element={<PlaygroundPage />} />
              <Route path="/ecosystem" element={<EcosystemPage />} />
              <Route path="/casebook" element={<CasebookPage />} />
              <Route path="/casebook/:id" element={<CasebookPage />} />
              <Route path="/my-learning" element={<MyLearningPage />} />
              <Route path="/content" element={<ContentPage />} />
              <Route path="/tutor" element={<TutorPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </Suspense>
        <ToastViewport />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
export default App;
