"use client";

import { useEffect } from "react";

function now() {
  return Date.now();
}

export default function ClientLogBridge() {
  useEffect(() => {
    let count = 0;
    let windowStart = now();

    async function send(payload: any) {
      try {
        // simple rolling rate limit: max 20 events / 60s
        const t = now();
        if (t - windowStart > 60_000) {
          windowStart = t;
          count = 0;
        }
        if (count >= 20) return;
        count += 1;

        await fetch("/api/logs/ingest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch {
        // ignore
      }
    }

    function onError(event: ErrorEvent) {
      const err = event.error;
      const msg = String(event.message || (err?.message ?? "UI_ERROR"));
      send({
        level: "error",
        category: "ui",
        event: "window_error",
        message: msg,
        data: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: err?.stack,
        },
      });
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason: any = (event as any).reason;
      const msg = String(reason?.message || reason || "UNHANDLED_REJECTION");
      send({
        level: "error",
        category: "ui",
        event: "unhandled_rejection",
        message: msg,
        data: {
          stack: reason?.stack,
          reason,
        },
      });
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
