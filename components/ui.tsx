import React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

function toneGradient(tone: string) {
  const tones: Record<string, string> = {
    neutral: "from-slate-900 via-slate-800 to-slate-700",
    info: "from-indigo-600 via-violet-600 to-sky-500",
    success: "from-emerald-600 via-teal-600 to-cyan-500",
    warning: "from-amber-500 via-orange-500 to-rose-500",
    danger: "from-rose-600 via-red-600 to-orange-500",
  };
  return tones[tone] || tones.neutral;
}

export function Container({
  children,
  wide = false,
  className = "",
}: {
  children?: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`${wide ? "max-w-[1800px]" : "max-w-7xl"} mx-auto px-4 sm:px-6 lg:px-8 py-7 sm:py-9 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
  className = "",
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/78 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl ${className}`}>
      <div className="absolute inset-0 bg-[radial-gradient(900px_circle_at_0%_0%,rgba(99,102,241,0.18),transparent_42%),radial-gradient(700px_circle_at_100%_0%,rgba(20,184,166,0.16),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(248,250,252,0.72))]" />
      <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="relative p-5 sm:p-7 lg:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="min-w-0 max-w-4xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
            Command workspace
          </div>
          <h1 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-950 font-display truncate">{title}</h1>
          {subtitle ? <p className="mt-2 text-sm sm:text-base text-slate-600 leading-6 max-w-3xl">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0 flex items-center gap-2 flex-wrap lg:justify-end">{right}</div> : null}
      </div>
    </div>
  );
}

export function Card({
  title,
  subtitle,
  children,
  right,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`premium-card ${className}`}>
      <div className="p-4 sm:p-5 lg:p-6">
        {title ? (
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_0_4px_rgba(99,102,241,0.13)]" />
                <h2 className="card-title truncate">{title}</h2>
              </div>
              {subtitle ? <p className="card-subtitle">{subtitle}</p> : null}
            </div>
            {right ? <div className="shrink-0">{right}</div> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent ${className}`} />;
}

export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { titleText?: string }) {
  const { className = "", titleText, ...rest } = props;
  return (
    <button
      title={titleText}
      className={`h-10 w-10 rounded-2xl border border-slate-200/80 bg-white/80 hover:bg-white inline-flex items-center justify-center transition shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-200/70 ${className}`}
      {...rest}
    />
  );
}

type PillTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "green"
  | "red"
  | "gray"
  | "amber";

export function Pill({ children, tone = "neutral" }: { children?: React.ReactNode; tone?: PillTone }) {
  const base = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm";
  const t = tone === "green" ? "success" : tone === "red" ? "danger" : tone === "gray" ? "neutral" : tone === "amber" ? "warning" : tone;
  const tones: Record<string, string> = {
    neutral: "border-slate-200 bg-white/80 text-slate-700",
    success: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
    warning: "border-amber-200 bg-amber-50/90 text-amber-800",
    danger: "border-red-200 bg-red-50/90 text-red-700",
    info: "border-indigo-200 bg-indigo-50/90 text-indigo-700",
  };
  return <span className={`${base} ${tones[t] || tones.neutral}`}>{children}</span>;
}

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-xs font-medium border border-slate-200/90 bg-white/80 text-slate-700 shadow-sm">
      {children}
    </span>
  );
}

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
  }
) {
  const { className = "", variant = "primary", disabled, ...rest } = props;
  const base =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold transition border shadow-sm hover:shadow-md active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-indigo-200/70 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:shadow-sm disabled:active:scale-100";
  const v =
    variant === "primary"
      ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-indigo-500/40 hover:from-indigo-700 hover:to-violet-700"
      : variant === "secondary"
        ? "bg-slate-950 text-white border-slate-900/20 hover:bg-slate-800"
        : variant === "danger"
          ? "bg-gradient-to-r from-red-600 to-rose-600 text-white border-red-500/40 hover:from-red-700 hover:to-rose-700"
          : "bg-white/80 text-slate-700 border-slate-200/90 hover:bg-white";
  return <button className={`${base} ${v} ${className}`} disabled={disabled} {...rest} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", type, ...rest } = props;
  if (type === "checkbox") {
    return <input type="checkbox" className={`h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200 ${className}`} {...rest} />;
  }
  return (
    <input
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/80 shadow-sm outline-none transition focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300 placeholder:text-slate-400 ${className}`}
      type={type}
      {...rest}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/80 shadow-sm outline-none transition focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300 ${className}`}
      {...rest}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      className={`w-full px-3.5 py-2.5 rounded-2xl border border-slate-200/90 bg-white/80 shadow-sm outline-none min-h-[150px] transition focus:ring-4 focus:ring-indigo-100 focus:border-indigo-300 placeholder:text-slate-400 ${className}`}
      {...rest}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <TextArea {...props} />;
}

export function Kpi({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const ring =
    tone === "success"
      ? "ring-emerald-200/70"
      : tone === "warning"
        ? "ring-amber-200/70"
        : tone === "danger"
          ? "ring-red-200/70"
          : tone === "info"
            ? "ring-indigo-200/70"
            : "ring-slate-200/70";
  return (
    <div className={`relative overflow-hidden rounded-[1.6rem] border border-white/70 bg-white/78 p-4 sm:p-5 shadow-[0_18px_50px_rgba(15,23,42,0.07)] ring-1 ${ring}`}>
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${toneGradient(tone)}`} />
      <div className="text-[11px] uppercase tracking-[0.2em] font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 font-display">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-600 leading-5">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="premium-card p-10 text-center">
      <div className="mx-auto h-14 w-14 rounded-3xl border border-white/70 bg-gradient-to-br from-indigo-600 to-emerald-500 grid place-items-center text-2xl shadow-lg text-white">
        ✨
      </div>
      <div className="mt-4 text-lg font-semibold text-slate-950 font-display">{title}</div>
      {subtitle ? <div className="mt-1 text-sm text-slate-600 max-w-xl mx-auto leading-6">{subtitle}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide = false,
}: {
  title: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const node = (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className={`w-full ${wide ? "max-w-6xl" : "max-w-xl"} overflow-hidden rounded-[2rem] border border-white/60 bg-white/90 shadow-[0_35px_120px_rgba(15,23,42,0.35)] backdrop-blur-xl max-h-[calc(100vh-2rem)] flex flex-col`}
        >
          <div className="relative overflow-hidden px-5 py-4 border-b border-slate-200/70 flex items-start justify-between gap-3">
            <div className="absolute inset-0 bg-[radial-gradient(600px_circle_at_0%_0%,rgba(99,102,241,0.16),transparent_50%),radial-gradient(500px_circle_at_100%_0%,rgba(16,185,129,0.12),transparent_50%)]" />
            <div className="relative min-w-0">
              <div className="text-lg font-semibold text-slate-950 truncate font-display">{title}</div>
            </div>
            <button
              className="relative h-10 w-10 rounded-2xl border border-slate-200 bg-white/80 hover:bg-white inline-flex items-center justify-center transition shadow-sm"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="p-5 overflow-y-auto">{children}</div>
          {footer ? <div className="px-5 py-4 border-t border-slate-200/70 bg-white/70 shrink-0">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}

export function Segmented({
  value,
  options,
  onChange,
  className = "",
}: {
  value: string;
  options: Array<{ value: string; label: React.ReactNode; disabled?: boolean }>;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center rounded-2xl border border-slate-200/90 bg-white/70 p-1 shadow-sm overflow-hidden ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-sm font-medium rounded-xl transition ${
            value === o.value ? "bg-slate-950 text-white shadow-sm" : "text-slate-700 hover:bg-white"
          } disabled:opacity-50`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedNav({
  active,
  items,
  className = "",
}: {
  active: string;
  items: Array<{ href: string; value: string; label: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center rounded-2xl border border-slate-200/90 bg-white/70 p-1 shadow-sm overflow-x-auto ${className}`}>
      {items.map((it) => (
        <Link
          key={it.value}
          href={it.href}
          className={`px-3 py-2 text-sm font-medium rounded-xl whitespace-nowrap transition ${active === it.value ? "bg-slate-950 text-white shadow-sm" : "text-slate-700 hover:bg-white"}`}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}
