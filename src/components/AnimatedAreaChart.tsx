import React, { useEffect, useMemo, useRef, useState } from 'react';

interface AnimatedAreaChartProps {
  data: number[];
  delay?: number;
  stroke?: string;
  fill?: string;
  dotColor?: string;
}

// Smooth cubic-bezier path through points (monotone-ish catmull-rom -> bezier).
function buildPaths(points: { x: number; y: number }[]): { line: string; area: string } {
  if (points.length === 0) return { line: '', area: '' };
  if (points.length === 1) {
    const p = points[0];
    return { line: `M ${p.x} ${p.y}`, area: `M ${p.x} 40 L ${p.x} ${p.y} L ${p.x} 40 Z` };
  }
  // Convert to cubic bezier using Catmull-Rom.
  let line = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    line += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  // Area: line then down to baseline and back.
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L ${last.x} 40 L ${first.x} 40 Z`;
  return { line, area };
}

export const AnimatedAreaChart: React.FC<AnimatedAreaChartProps> = ({
  data,
  delay = 0,
  stroke = 'white',
  fill = 'rgba(255,255,255,0.25)',
  dotColor = 'white',
}) => {
  const reduceMotion =
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [animated, setAnimated] = useState(false);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [length, setLength] = useState(0);

  const points = useMemo(() => {
    const n = data.length || 1;
    const max = Math.max(1, ...data);
    return data.map((v, i) => ({
      x: n > 1 ? (i / (n - 1)) * 100 : 50,
      y: 36 - (v / max) * 28,
    }));
  }, [data]);

  const { line, area } = useMemo(() => buildPaths(points), [points]);

  useEffect(() => {
    if (pathRef.current) {
      try {
        setLength(pathRef.current.getTotalLength());
      } catch {
        setLength(1000);
      }
    }
  }, [line]);

  useEffect(() => {
    if (reduceMotion) {
      setAnimated(true);
      return;
    }
    setAnimated(false);
    const t = window.setTimeout(() => setAnimated(true), delay + 50);
    return () => window.clearTimeout(t);
  }, [data, delay, reduceMotion]);

  return (
    <svg viewBox="0 0 100 40" className="w-full h-12 overflow-visible" preserveAspectRatio="none">
      {/* Baseline */}
      <line x1="0" y1="40" x2="100" y2="40" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      {/* Area fill */}
      <path
        d={area}
        fill={fill}
        style={{
          opacity: animated ? 1 : 0,
          transition: reduceMotion ? 'none' : 'opacity 0.8s ease-out',
        }}
      />
      {/* Line */}
      <path
        ref={pathRef}
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          strokeDasharray: length || 1000,
          strokeDashoffset: animated ? 0 : length || 1000,
          transition: reduceMotion ? 'none' : 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)',
        }}
      />
      {/* Dots */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="2"
          fill={dotColor}
          style={{
            opacity: animated ? 1 : 0,
            transition: reduceMotion ? 'none' : `opacity 0.4s ease-out ${i * 60}ms`,
          }}
        />
      ))}
    </svg>
  );
};
