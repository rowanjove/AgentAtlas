export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/brand-icon.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="shrink-0 object-contain select-none rounded-[var(--radius-xs)]"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}
