"use client";

import React from "react";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normalize(values: number[]) {
  const max = Math.max(1, ...values);
  return values.map((v) => v / max);
}

export function Sparkline({ values, height = 24 }: { values: number[]; height?: number }) {
  const w = 72;
  const h = height;
  const pad = 2;
  if (!values || values.length === 0) return <div className="h-6 w-18" />;
  const n = normalize(values);
  const step = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = n
    .map((v, i) => {
      const x = pad + i * step;
      const y = pad + (1 - v) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-90">
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} />
    </svg>
  );
}

export function LineAreaChart({
  labels,
  series,
  height = 180,
  legend,
}: {
  labels: string[];
  series: { name: string; values: number[] }[];
  height?: number;
  legend?: boolean;
}) {
  const w = 900;
  const h = height;
  const padX = 24;
  const padY = 16;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const step = (w - padX * 2) / Math.max(1, labels.length - 1);

  const paths = series.map((s, idx) => {
    const pts = s.values.map((v, i) => {
      const x = padX + i * step;
      const y = padY + (1 - v / max) * (h - padY * 2);
      return { x, y };
    });

    const d = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");

    // area
    const area = `${d} L${(padX + (labels.length - 1) * step).toFixed(1)} ${(h - padY).toFixed(1)} L${padX.toFixed(1)} ${(h - padY).toFixed(1)} Z`;

    return {
      idx,
      name: s.name,
      d,
      area,
    };
  });

  // label sampling
  const ticks = labels.length <= 10 ? labels.map((_, i) => i) : [0, Math.floor(labels.length / 2), labels.length - 1];

  return (
    <div>
      <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white/60">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto text-indigo-600">
          {/* grid */}
          {[0.25, 0.5, 0.75].map((t) => {
            const y = padY + (1 - t) * (h - padY * 2);
            return <line key={t} x1={padX} y1={y} x2={w - padX} y2={y} stroke="rgba(15,23,42,0.08)" strokeWidth="1" />;
          })}

          {paths.map((p) => (
            <g key={p.idx}>
              <path d={p.area} fill="currentColor" opacity={0.08 + p.idx * 0.04} />
              <path d={p.d} fill="none" stroke="currentColor" strokeWidth="2.2" opacity={0.9 - p.idx * 0.15} />
            </g>
          ))}

          {/* x labels */}
          {ticks.map((i) => {
            const x = padX + i * step;
            const text = labels[i]?.slice(5); // MM-DD
            return (
              <text key={i} x={x} y={h - 6} fontSize="11" textAnchor="middle" fill="rgba(15,23,42,0.55)">
                {text}
              </text>
            );
          })}
        </svg>
      </div>

      {legend ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-2 text-xs text-slate-700">
              <span className="h-2 w-2 rounded-full bg-indigo-600" style={{ opacity: 0.9 - i * 0.2 }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BarList({
  items,
  valueKey,
  labelKey,
  right,
}: {
  items: any[];
  valueKey: string;
  labelKey: string;
  right?: (item: any) => React.ReactNode;
}) {
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey] ?? 0)));
  return (
    <div className="space-y-2">
      {items.map((it, idx) => {
        const v = Number(it[valueKey] ?? 0);
        const pct = (v / max) * 100;
        return (
          <div key={it.id ?? idx} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <div className="truncate text-sm text-slate-900">{String(it[labelKey])}</div>
                <div className="shrink-0 text-xs text-slate-600 tabular-nums">{v.toLocaleString()}</div>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                <div className="h-full bg-indigo-600/70" style={{ width: `${clamp(pct, 0, 100)}%` }} />
              </div>
            </div>
            {right ? <div className="shrink-0">{right(it)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function Heatmap({
  matrix,
  rowLabels,
  colLabels,
  title,
}: {
  matrix: number[][]; // rows x cols
  rowLabels: string[];
  colLabels: string[];
  title?: string;
}) {
  const flat = matrix.flat();
  const max = Math.max(1, ...flat);
  const cols = colLabels.length;
  return (
    <div>
      {title ? <div className="text-sm font-medium text-slate-900 mb-3">{title}</div> : null}
      <div className="overflow-auto">
        <div className="min-w-[860px]">
          <div className="grid" style={{ gridTemplateColumns: `120px repeat(${cols}, minmax(20px, 1fr))` }}>
            <div />
            {colLabels.map((c) => (
              <div key={c} className="text-[11px] text-slate-500 text-center pb-2">
                {c}
              </div>
            ))}
            {matrix.map((row, r) => (
              <React.Fragment key={r}>
                <div className="text-xs text-slate-600 pr-2 py-1 flex items-center">{rowLabels[r]}</div>
                {row.map((v, c) => {
                  const a = v / max;
                  return (
                    <div
                      key={`${r}-${c}`}
                      title={`${rowLabels[r]} @ ${colLabels[c]}: ${v}`}
                      className="h-6 rounded-md border border-slate-200"
                      style={{ backgroundColor: `rgba(99,102,241,${0.08 + 0.75 * a})` }}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-600">Darker = more activity.</div>
        </div>
      </div>
    </div>
  );
}
