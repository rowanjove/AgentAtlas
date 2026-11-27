import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

let renderQueue: Promise<void> = Promise.resolve();
let renderSeq = 0;

interface ParsedSvg {
  svg: string;
  vbW: number;
  vbH: number;
}

const MIN_SCALE = 0.35;
const MAX_SCALE = 3.0;
const BBOX_PAD = 24;

function clampScale(val: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(val.toFixed(2))));
}

function sanitizeMermaidSvg(rawSvg: string): ParsedSvg {
  const parser = new DOMParser();
  let doc = parser.parseFromString(rawSvg, 'image/svg+xml');
  let svgEl = doc.querySelector('svg');

  if (!svgEl || doc.querySelector('parsererror')) {
    doc = parser.parseFromString(rawSvg, 'text/html');
    svgEl = doc.querySelector('svg');
  }

  if (!svgEl) {
    return { svg: rawSvg, vbW: 740, vbH: 260 };
  }

  let vbW = 740;
  let vbH = 260;
  const vbAttr = svgEl.getAttribute('viewBox');
  if (vbAttr) {
    const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && Number.isFinite(parts[2]) && parts[2] > 0 && Number.isFinite(parts[3]) && parts[3] > 0) {
      vbW = parts[2];
      vbH = parts[3];
    }
  } else {
    const wNum = Number.parseFloat(svgEl.getAttribute('width') || '');
    const hNum = Number.parseFloat(svgEl.getAttribute('height') || '');
    if (Number.isFinite(wNum) && wNum > 0) vbW = wNum;
    if (Number.isFinite(hNum) && hNum > 0) vbH = hNum;
  }

  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
  svgEl.removeAttribute('style');
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  for (const styleEl of svgEl.querySelectorAll('style')) {
    if (styleEl.textContent) {
      styleEl.textContent = styleEl.textContent.replace(/max-width\s*:[^;}]+;?/gi, '');
    }
  }

  const serialized = new XMLSerializer().serializeToString(svgEl);
  return { svg: serialized, vbW, vbH };
}

function computeSvgContentBounds(svgEl: SVGSVGElement): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const tryAddBox = (el: SVGGraphicsElement) => {
    try {
      const b = el.getBBox();
      if (b.width > 0 || b.height > 0) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
    } catch {
      // ignore unmeasurable element
    }
  };

  tryAddBox(svgEl);
  for (const child of svgEl.querySelectorAll<SVGGraphicsElement>('g.nodes > g, g.edgePaths > path, g.edgeLabels > g, g.clusters > g, rect, polygon, text')) {
    tryAddBox(child);
  }

  if (Number.isFinite(minX) && Number.isFinite(minY) && maxX > minX && maxY > minY) {
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return null;
}

function MermaidCanvas({
  parsed,
  zoomMode,
  fitMode = 'width',
  customScale,
  onStepScale,
  onMeasuredScaleChange,
  surfaceId,
  className,
}: {
  parsed: ParsedSvg;
  zoomMode: 'fit' | 'custom';
  fitMode?: 'width' | 'contain';
  customScale: number;
  onStepScale: (delta: number) => void;
  onMeasuredScaleChange?: (scale: number) => void;
  surfaceId?: string;
  className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const [availSize, setAvailSize] = useState<{ w: number; h: number }>({ w: 740, h: 480 });
  const [bboxSize, setBboxSize] = useState<{ vbW: number; vbH: number }>({ vbW: parsed.vbW, vbH: parsed.vbH });
  const [isDragging, setIsDragging] = useState(false);

  const calibrateViewBox = useCallback(() => {
    const mount = mountRef.current;
    const svgEl = mount?.querySelector('svg');
    if (!svgEl) return;

    svgEl.style.display = 'block';
    svgEl.style.maxWidth = 'none';
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    const bounds = computeSvgContentBounds(svgEl);
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const vbX = Math.floor(bounds.x - BBOX_PAD);
      const vbY = Math.floor(bounds.y - BBOX_PAD);
      const vbW = Math.ceil(bounds.width + BBOX_PAD * 2);
      const vbH = Math.ceil(bounds.height + BBOX_PAD * 2);
      svgEl.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
      setBboxSize((prev) => (prev.vbW === vbW && prev.vbH === vbH ? prev : { vbW, vbH }));
    }
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => {
      if (vp.clientWidth > 0 && vp.clientHeight > 0) {
        setAvailSize({
          w: Math.max(300, vp.clientWidth - 36),
          h: Math.max(200, vp.clientHeight - 36),
        });
        calibrateViewBox();
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [calibrateViewBox]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        onStepScale(e.deltaY < 0 ? 0.15 : -0.15);
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [onStepScale]);

  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    mount.innerHTML = parsed.svg;
    calibrateViewBox();
    const raf = requestAnimationFrame(calibrateViewBox);
    return () => cancelAnimationFrame(raf);
  }, [parsed, calibrateViewBox]);

  const widthRatio = availSize.w / Math.max(1, bboxSize.vbW);
  const heightRatio = availSize.h / Math.max(1, bboxSize.vbH);
  const fitScale = fitMode === 'contain' ? Math.min(1.4, widthRatio, heightRatio) : Math.min(1, widthRatio);
  const activeScale = zoomMode === 'fit' ? fitScale : customScale;

  useEffect(() => {
    onMeasuredScaleChange?.(activeScale);
  }, [activeScale, onMeasuredScaleChange]);

  const targetW = Math.max(120, Math.round(bboxSize.vbW * activeScale));
  const targetH = Math.max(60, Math.round(bboxSize.vbH * activeScale));

  useLayoutEffect(() => {
    const svgEl = mountRef.current?.querySelector('svg');
    if (!svgEl) return;
    svgEl.setAttribute('width', String(targetW));
    svgEl.setAttribute('height', String(targetH));
    svgEl.style.width = `${targetW}px`;
    svgEl.style.height = `${targetH}px`;
    svgEl.style.maxWidth = 'none';
  }, [parsed, targetW, targetH]);

  const canPan = targetW > availSize.w + 4 || targetH > availSize.h + 4;

  return (
    <div
      id={surfaceId}
      ref={viewportRef}
      onPointerDown={(e) => {
        if (e.button !== 0 || !viewportRef.current) return;
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          scrollLeft: viewportRef.current.scrollLeft,
          scrollTop: viewportRef.current.scrollTop,
        };
        viewportRef.current.setPointerCapture(e.pointerId);
        setIsDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current || !viewportRef.current) return;
        viewportRef.current.scrollLeft = dragRef.current.scrollLeft - (e.clientX - dragRef.current.startX);
        viewportRef.current.scrollTop = dragRef.current.scrollTop - (e.clientY - dragRef.current.startY);
      }}
      onPointerUp={(e) => {
        if (dragRef.current && viewportRef.current?.hasPointerCapture(e.pointerId)) {
          viewportRef.current.releasePointerCapture(e.pointerId);
        }
        dragRef.current = null;
        setIsDragging(false);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setIsDragging(false);
      }}
      className={`atlas-mermaid p-4 overflow-auto flex bg-[var(--panel)] select-none ${
        isDragging ? 'cursor-grabbing' : canPan ? 'cursor-grab' : 'cursor-default'
      } ${className ?? ''}`}
      title="按住左键可拖拽平移，Ctrl + 滚轮缩放"
    >
      <div
        ref={mountRef}
        className="m-auto shrink-0"
        style={{ width: `${targetW}px`, height: `${targetH}px` }}
      />
    </div>
  );
}

export function MermaidDiagram({ chart }: { chart: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const surfaceId = `mmd_surface_${id}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const theme = useAppStore((s) => s.theme);

  const [parsed, setParsed] = useState<ParsedSvg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [modalReady, setModalReady] = useState(false);

  const [zoomMode, setZoomMode] = useState<'fit' | 'custom'>('fit');
  const [customScale, setCustomScale] = useState(1);
  const [effectiveScale, setEffectiveScale] = useState(1);

  const [modalZoomMode, setModalZoomMode] = useState<'fit' | 'custom'>('fit');
  const [modalCustomScale, setModalCustomScale] = useState(1);
  const [modalEffectiveScale, setModalEffectiveScale] = useState(1);

  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    let active = true;
    const isDark = theme === 'dark' || (theme === 'system' && systemDark);

    const runRender = async () => {
      const { default: mermaid } = await import('mermaid');
      if (!active) return;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: isDark ? 'dark' : 'default',
        fontFamily: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, -apple-system, "Segoe UI", sans-serif',
        fontSize: 14,
        htmlLabels: false,
        flowchart: {
          htmlLabels: false,
          useMaxWidth: false,
          padding: 18,
          nodeSpacing: 32,
          rankSpacing: 36,
        },
        sequence: {
          useMaxWidth: false,
        },
        state: {
          useMaxWidth: false,
        },
      });

      const renderId = `mmd_${id}_${++renderSeq}`;
      const res = await mermaid.render(renderId, chart.trim());
      if (active && res) {
        setParsed(sanitizeMermaidSvg(res.svg));
        setError(null);
      }
    };

    renderQueue = renderQueue
      .then(runRender)
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Mermaid render error');
        }
      });

    return () => {
      active = false;
    };
  }, [chart, id, theme, systemDark]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (fullscreen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      setModalZoomMode('fit');
      setModalCustomScale(1);
      setModalReady(true);
    } else {
      setModalReady(false);
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [fullscreen]);

  const stepInlineScale = useCallback(
    (delta: number) => {
      setZoomMode('custom');
      setCustomScale((prev) => clampScale((zoomMode === 'fit' ? effectiveScale : prev) + delta));
    },
    [zoomMode, effectiveScale],
  );

  const stepModalScale = useCallback(
    (delta: number) => {
      setModalZoomMode('custom');
      setModalCustomScale((prev) => clampScale((modalZoomMode === 'fit' ? modalEffectiveScale : prev) + delta));
    },
    [modalZoomMode, modalEffectiveScale],
  );

  const handleToolbarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ('focusGroup' in HTMLElement.prototype) return;
    const bar = toolbarRef.current;
    if (!bar) return;
    const items = Array.from(bar.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item]'));
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;

    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = items.length - 1;

    if (nextIdx !== -1) {
      e.preventDefault();
      items.forEach((btn, i) => {
        btn.tabIndex = i === nextIdx ? 0 : -1;
      });
      items[nextIdx].focus();
    }
  };

  const handleToolbarFocusCapture = (e: React.FocusEvent<HTMLDivElement>) => {
    if ('focusGroup' in HTMLElement.prototype) return;
    const bar = toolbarRef.current;
    if (!bar) return;
    const target = e.target as HTMLElement;
    const items = Array.from(bar.querySelectorAll<HTMLButtonElement>('button[data-toolbar-item]'));
    if (items.includes(target as HTMLButtonElement)) {
      items.forEach((btn) => {
        btn.tabIndex = btn === target ? 0 : -1;
      });
    }
  };

  const renderControls = (inModal = false) => {
    const curZoomMode = inModal ? modalZoomMode : zoomMode;
    const curEffScale = inModal ? modalEffectiveScale : effectiveScale;
    const onStep = inModal ? stepModalScale : stepInlineScale;
    const setMode = inModal ? setModalZoomMode : setZoomMode;
    const setCustom = inModal ? setModalCustomScale : setCustomScale;

    return (
      <div
        ref={inModal ? undefined : toolbarRef}
        role="toolbar"
        aria-label="图表缩放与视图控制"
        aria-controls={surfaceId}
        onKeyDown={inModal ? undefined : handleToolbarKeyDown}
        onFocusCapture={inModal ? undefined : handleToolbarFocusCapture}
        {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
        className="flex items-center gap-1.5 flex-wrap text-xs"
      >
        {!error && !showSource && parsed && (
          <div
            role="group"
            aria-label="缩放控制"
            className="inline-flex items-center rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] overflow-hidden"
          >
            <button
              type="button"
              data-toolbar-item="true"
              onClick={() => onStep(-0.15)}
              className="h-7 px-2 inline-flex items-center justify-center hover:bg-[var(--panel-sec)] text-[var(--text)] cursor-pointer transition-colors"
              title="缩小图表"
              aria-label="缩小图表"
            >
              <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-toolbar-item="true"
              onClick={() => {
                setMode('custom');
                setCustom(1);
              }}
              className="h-7 min-w-12 px-2 border-x border-[var(--border)] hover:bg-[var(--panel-sec)] font-mono text-xs cursor-pointer transition-colors"
              title="切换至 100% 原始比例"
            >
              {Math.round(curEffScale * 100)}%
            </button>
            <button
              type="button"
              data-toolbar-item="true"
              onClick={() => onStep(0.15)}
              className="h-7 px-2 inline-flex items-center justify-center hover:bg-[var(--panel-sec)] text-[var(--text)] cursor-pointer transition-colors"
              title="放大图表"
              aria-label="放大图表"
            >
              <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              data-toolbar-item="true"
              aria-pressed={curZoomMode === 'fit'}
              onClick={() => setMode((m) => (m === 'fit' ? 'custom' : 'fit'))}
              className="h-7 px-2.5 border-l border-[var(--border)] cursor-pointer hover:bg-[var(--panel-sec)] aria-[pressed=true]:bg-[var(--selected-bg)] aria-[pressed=true]:text-[var(--primary)] aria-[pressed=true]:font-medium transition-colors"
              title="自动适配可视窗口"
            >
              适配
            </button>
          </div>
        )}

        {!error && !showSource && parsed && !inModal && (
          <>
            <span role="separator" aria-orientation="vertical" className="h-4 border-l border-[var(--border)]" />
            <button
              type="button"
              data-toolbar-item="true"
              onClick={() => setFullscreen(true)}
              className="h-7 px-2.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-sec)] inline-flex items-center gap-1 cursor-pointer transition-colors"
              title="全屏大图查看"
              aria-label="全屏大图查看"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>全屏</span>
            </button>
          </>
        )}

        <span role="separator" aria-orientation="vertical" className="h-4 border-l border-[var(--border)]" />
        <button
          type="button"
          data-toolbar-item="true"
          aria-pressed={showSource}
          onClick={() => setShowSource((v) => !v)}
          className="h-7 px-2.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-sec)] aria-[pressed=true]:border-[var(--primary)] aria-[pressed=true]:text-[var(--primary)] cursor-pointer transition-colors"
        >
          {showSource ? '查看图示' : '查看源码'}
        </button>
      </div>
    );
  };

  return (
    <div className="my-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-[var(--border)] bg-[var(--panel-sec)] text-xs text-[var(--text-sec)]">
        <span className="font-mono font-medium">Mermaid 机制图解</span>
        {renderControls(false)}
      </div>

      {error || showSource ? (
        <pre className="p-4 text-[13px] overflow-x-auto font-mono bg-[var(--panel-sec)]">
          {error ? `// 渲染回退源码 (${error})\n` : ''}
          {chart}
        </pre>
      ) : parsed ? (
        <MermaidCanvas
          parsed={parsed}
          zoomMode={zoomMode}
          fitMode="width"
          customScale={customScale}
          onStepScale={stepInlineScale}
          onMeasuredScaleChange={setEffectiveScale}
          surfaceId={surfaceId}
        />
      ) : (
        <div className="py-8 text-center text-[13px] text-[var(--text-sec)]">正在渲染机制图解...</div>
      )}

      <dialog
        ref={dialogRef}
        aria-label="Mermaid 图解全屏查看"
        onClose={() => {
          if (dialogRef.current) dialogRef.current.returnValue = '';
          setFullscreen(false);
        }}
        onClick={(e) => {
          const dialog = dialogRef.current;
          if (!dialog) return;
          const rect = dialog.getBoundingClientRect();
          if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            setFullscreen(false);
          }
        }}
        style={{ width: '94vw', maxWidth: '94vw', height: '88vh', maxHeight: '88vh', margin: 'auto' }}
      >
        {modalReady && parsed && (
          <div className="h-full flex flex-col bg-[var(--panel)] overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--panel-sec)] text-[13px] shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-mono font-semibold text-[var(--text)]">Mermaid 机制图解（全屏模式）</span>
                <span className="text-xs text-[var(--text-sec)] hidden sm:inline">按住左键拖拽平移 · Ctrl+滚轮缩放</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {renderControls(true)}
                <button
                  type="button"
                  onClick={() => {
                    setModalZoomMode('fit');
                    setModalCustomScale(1);
                  }}
                  className="h-7 px-2.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-sec)] text-xs inline-flex items-center gap-1 cursor-pointer"
                  title="恢复适配视口"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>重置</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  className="h-7 px-2.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--panel-sec)] text-xs inline-flex items-center gap-1 cursor-pointer"
                  aria-label="退出全屏"
                >
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>退出</span>
                </button>
              </div>
            </div>
            <MermaidCanvas
              parsed={parsed}
              zoomMode={modalZoomMode}
              fitMode="contain"
              customScale={modalCustomScale}
              onStepScale={stepModalScale}
              onMeasuredScaleChange={setModalEffectiveScale}
              className="flex-1 min-h-0"
            />
          </div>
        )}
      </dialog>
    </div>
  );
}
