import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface MarqueeTextProps {
  children: ReactNode;
  className?: string;
}

/**
 * Renders single-line label text that smoothly scrolls on parent hover (`.ytai-marquee-btn`)
 * ONLY when the text actually overflows its available width.
 */
export function MarqueeText({ children, className = '' }: MarqueeTextProps): ReactElement {
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const trackRef = useRef<HTMLSpanElement | null>(null);
  const [isClipped, setIsClipped] = useState(false);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;

    const measure = (): void => {
      const overflow = track.scrollWidth - wrap.clientWidth;
      if (overflow > 1.5) {
        const shiftPx = Math.ceil(overflow + 6);
        const durationSec = Math.max(2.0, Math.min(4.8, overflow / 18 + 1.6));
        track.style.setProperty('--ytai-marquee-shift', `-${shiftPx}px`);
        track.style.setProperty('--ytai-marquee-dur', `${durationSec.toFixed(2)}s`);
        setIsClipped((prev) => (prev ? prev : true));
      } else {
        track.style.removeProperty('--ytai-marquee-shift');
        track.style.removeProperty('--ytai-marquee-dur');
        setIsClipped((prev) => (prev ? false : prev));
      }
    };

    measure();
    const rafId = window.requestAnimationFrame(measure);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(wrap);
      observer.observe(track);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [children]);

  return (
    <span
      ref={wrapRef}
      className={`ytai-marquee-wrap ${isClipped ? 'is-clipped' : ''} ${className}`.trim()}
    >
      <span ref={trackRef} className="ytai-marquee-track">
        {children}
      </span>
    </span>
  );
}
