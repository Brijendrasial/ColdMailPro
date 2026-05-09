import React from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

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
    <div className={`${wide ? "max-w-none" : "max-w-7xl"} mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 ${className}`}>
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
    <div className={`flex items-start sm:items-center justify-between gap-3 flex-wrap ${className}`}>
      <div className="min-w-0">
        <div className="text-2xl font-semibold tracking-tight text-slate-900 font-display truncate">{title}</div>
        {subtitle ? <div className="text-sm text-slate-600 mt-1 max-w-3xl">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
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
    <div className={`glass ${className}`}>
      <div className="p-4 sm:p-5">
        {title ? (
          <div className="mb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="card-title truncate">{title}</div>
                {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
              </div>
              {right ? <div className="shrink-0">{right}</div> : null}
            </div>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={`h-px w-full bg-slate-200/80 ${className}`} />;
}

export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { titleText?: string }) {
  const { className = "", titleText, ...rest } = props;
  return (
    <button
      title={titleText}
      className={`h-9 w-9 rounded-xl border border-slate-200 bg-white/70 hover:bg-white inline-flex items-center justify-center transition focus:outline-none focus:ring-2 focus:ring-indigo-200/70 ${className}`}
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
  // legacy aliases used in a few places
  | "green"
  | "red"
  | "gray"
  | "amber";

export function Pill({ children, tone = "neutral" }: { children?: React.ReactNode; tone?: PillTone }) {
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border";
  const t = tone === "green" ? "success" : tone === "red" ? "danger" : tone === "gray" ? "neutral" : tone === "amber" ? "warning" : tone;

  const tones: Record<string, string> = {
    neutral: "border-slate-200 bg-slate-50/80 text-slate-700",
    success: "border-emerald-200 bg-emerald-50/80 text-emerald-700",
    warning: "border-amber-200 bg-amber-50/80 text-amber-700",
    danger: "border-red-200 bg-red-50/80 text-red-700",
    info: "border-indigo-200 bg-indigo-50/80 text-indigo-700",
  };
  return <span className={`${base} ${tones[t] || tones.neutral}`}>{children}</span>;
}

export function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs border border-slate-200 bg-white/70 text-slate-700">
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
    "px-4 py-2 rounded-xl text-sm font-medium transition border focus:outline-none focus:ring-2 focus:ring-indigo-200/70 disabled:opacity-60 disabled:cursor-not-allowed";
  const v =
    variant === "primary"
      ? "bg-indigo-600 text-white border-indigo-700/30 hover:bg-indigo-700"
      : variant === "secondary"
        ? "bg-slate-900 text-white border-slate-900/20 hover:bg-slate-800"
        : variant === "danger"
          ? "bg-red-600 text-white border-red-700/30 hover:bg-red-700"
          : "bg-white/70 text-slate-700 border-slate-200 hover:bg-white";
  return <button className={`${base} ${v} ${className}`} disabled={disabled} {...rest} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", type, ...rest } = props;

  if (type === "checkbox") {
    return (
      <input
        type="checkbox"
        className={`h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200 ${className}`}
        {...rest}
      />
    );
  }

  return (
    <input
      className={`w-full px-3 py-2 rounded-xl border border-slate-200 bg-white/70 outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 placeholder:text-slate-400 ${className}`}
      type={type}
      {...rest}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      className={`w-full px-3 py-2 rounded-xl border border-slate-200 bg-white/70 outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 ${className}`}
      {...rest}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return (
    <textarea
      className={`w-full px-3 py-2 rounded-xl border border-slate-200 bg-white/70 outline-none min-h-[140px] focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 placeholder:text-slate-400 ${className}`}
      {...rest}
    />
  );
}

// Back-compat alias
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
      ? "ring-emerald-200/60"
      : tone === "warning"
        ? "ring-amber-200/60"
        : tone === "danger"
          ? "ring-red-200/60"
          : tone === "info"
            ? "ring-indigo-200/60"
            : "ring-slate-200/60";

  return (
    <div className={`glass p-4 sm:p-5 ring-1 ${ring}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-600">{hint}</div> : null}
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
    <div className="glass p-8 text-center">
      <div className="mx-auto h-12 w-12 rounded-2xl border border-slate-200 bg-white/70 grid place-items-center text-xl">
        ✨
      </div>
      <div className="mt-3 text-base font-semibold text-slate-900">{title}</div>
      {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
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
      <div className="absolute inset-0 bg-black/35" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        {/*
          IMPORTANT: This modal is rendered via a portal (when document is available).
          This prevents "fixed inside transformed sidebar" bugs where the modal gets constrained
          to the sidebar width/height and ends up bottom-left / clipped.
        */}
        <div
          role="dialog"
          aria-modal="true"
          className={`w-full ${wide ? "max-w-5xl" : "max-w-xl"} glass shadow-2xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden`}
        >
          <div className="px-5 py-4 border-b border-slate-200/70 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-slate-900 truncate">{title}</div>
            </div>
            <button
              className="h-9 w-9 rounded-xl border border-slate-200 bg-white/70 hover:bg-white inline-flex items-center justify-center transition"
              onClick={onClose}
              aria-label="Close"
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="p-5 overflow-y-auto">{children}</div>
          {footer ? <div className="px-5 py-4 border-t border-slate-200/70 shrink-0">{footer}</div> : null}
        </div>
      </div>
    </div>
  );

  // Portal to <body> so it's truly viewport-fixed even if opened from inside a transformed container.
  // In server-render / tests where document isn't available, fall back to inline render.
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
    <div className={`inline-flex items-center rounded-2xl border border-slate-200 bg-white/60 overflow-hidden ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-sm transition ${
            value === o.value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"
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
    <div className={`inline-flex items-center rounded-2xl border border-slate-200 bg-white/60 overflow-hidden ${className}`}>
      {items.map((it) => (
        <Link
          key={it.value}
          href={it.href}
          className={`px-3 py-2 text-sm transition ${active === it.value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-white"}`}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}
