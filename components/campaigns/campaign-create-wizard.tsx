"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Input, TextArea, Badge, Pill } from "@/components/ui";

type MailboxLite = { id: string; name: string; fromEmail: string; dailyLimit: number; isActive: boolean };
type LeadLite = { id: string; email: string; firstName?: string | null; lastName?: string | null; company?: string | null; status?: string | null };
type MailboxPoolLite = { id: string; name: string; membersCount: number };

type Props = {
  mailboxes: MailboxLite[];
  pools: MailboxPoolLite[];
  leads: LeadLite[];
  resumeCampaignId?: string | null;
};

const weekdayLabels: Array<[number, string]> = [
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [0, "Sun"],
];

function Stepper({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full grid place-items-center text-sm border border-slate-200 ${
              i === active ? "bg-slate-900 text-white border-slate-900/20" : "bg-white/70 text-slate-700"
            }`}
          >
            {i + 1}
          </div>
          <div className={`text-sm ${i === active ? "font-semibold text-slate-900" : "text-slate-600"}`}>{s}</div>
          {i < steps.length - 1 ? <div className="w-6 h-px bg-slate-200" /> : null}
        </div>
      ))}
    </div>
  );
}

async function postJson<T>(url: string, payload: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}) ${txt}`.slice(0, 400));
  }
  return (await res.json()) as T;
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default function CampaignCreateWizard({ mailboxes, pools, leads, resumeCampaignId }: Props) {
  const steps = ["Basics", "Senders", "Schedule & rules", "Sequence", "Leads", "Review"];
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [autoSaveErr, setAutoSaveErr] = useState<string | null>(null);
  const autoSaveT = useRef<any>(null);

  const [campaignId, setCampaignId] = useState<string | null>(null);

  // --- Basics ---
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [tzOptions, setTzOptions] = useState<string[]>([]);

  // --- Senders ---
  const [mailboxStrategy, setMailboxStrategy] = useState<"round_robin" | "random" | "weighted" | "least_recent">("round_robin");

  // Sender mode: manual select (campaignMailboxes) vs pool vs all
  const [senderMode, setSenderMode] = useState<"manual" | "pool" | "all">("manual");
  const [mailboxPoolId, setMailboxPoolId] = useState<string>("");
  const [mailboxIds, setMailboxIds] = useState<string[]>([]);

  // If user switches to pool mode and no pool is selected, preselect the most recently updated pool.
  useEffect(() => {
    if (senderMode !== "pool") return;
    if (mailboxPoolId) return;
    if (!pools || pools.length === 0) return;
    setMailboxPoolId(pools[0].id);
  }, [senderMode, mailboxPoolId, pools]);

  // --- Schedule & Limits ---
  const [sendingWindow, setSendingWindow] = useState("09:00-18:00");
  const [windowStart, setWindowStart] = useState("09:00");
  const [windowEnd, setWindowEnd] = useState("18:00");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startAt, setStartAt] = useState<string>(""); // YYYY-MM-DDTHH:MM (local)
  const [endAt, setEndAt] = useState<string>("");
  const [startAtDate, setStartAtDate] = useState<string>("");
  const [startAtTime, setStartAtTime] = useState<string>("");
  const [endAtDate, setEndAtDate] = useState<string>("");
  const [endAtTime, setEndAtTime] = useState<string>("");

  const [dailySendLimit, setDailySendLimit] = useState<number>(200);
  const [rampEnabled, setRampEnabled] = useState<boolean>(false);
  const [rampStartLimit, setRampStartLimit] = useState<number>(20);
  const [rampDailyIncrease, setRampDailyIncrease] = useState<number>(20);
  const [rampMaxLimit, setRampMaxLimit] = useState<number>(200);

  const [perMailboxPerMinute, setPerMailboxPerMinute] = useState<number>(20);
  const [domainDailyCap, setDomainDailyCap] = useState<number>(25);
  const [domainCaps, setDomainCaps] = useState<string>(""); // JSON map

  const [guardEnabled, setGuardEnabled] = useState<boolean>(true);
  const [guardWindowHours, setGuardWindowHours] = useState<number>(24);
  const [guardMinSent, setGuardMinSent] = useState<number>(50);
  const [guardMaxHardBounceRate, setGuardMaxHardBounceRate] = useState<number>(0.05);
  const [guardMaxBounceRate, setGuardMaxBounceRate] = useState<number>(0.08);
  const [guardMaxUnsubRate, setGuardMaxUnsubRate] = useState<number>(0.02);

  const [autoThrottleEnabled, setAutoThrottleEnabled] = useState<boolean>(true);
  const [autoThrottleWindowMinutes, setAutoThrottleWindowMinutes] = useState<number>(60);
  const [autoThrottleMinSent, setAutoThrottleMinSent] = useState<number>(20);
  const [autoThrottleMaxHardBounceRate, setAutoThrottleMaxHardBounceRate] = useState<number>(0.08);
  const [autoThrottleMaxBounceRate, setAutoThrottleMaxBounceRate] = useState<number>(0.12);
  const [autoThrottleCooldownMinutes, setAutoThrottleCooldownMinutes] = useState<number>(120);

  // --- Stop rules ---
  const [stopOnReply, setStopOnReply] = useState(true);
  const [stopOnBounce, setStopOnBounce] = useState(true);
  const [stopOnUnsubscribe, setStopOnUnsubscribe] = useState(true);
  const [stopOnOOO, setStopOnOOO] = useState(true);
  const [stopKeywords, setStopKeywords] = useState("");
  const [notInterestedKeywords, setNotInterestedKeywords] = useState("");
  const [oooKeywords, setOooKeywords] = useState("");

  // --- Sequence (2 steps + optional B variants) ---
  const [s1Subject, setS1Subject] = useState("Quick question, {{firstName}}");
  const [s1Body, setS1Body] = useState("Hi {{firstName}},\n\n...\n\n— {{senderName}}");
  const [s2Delay, setS2Delay] = useState<number>(2);
  const [s2Subject, setS2Subject] = useState("Re: {{company}}");
  const [s2Body, setS2Body] = useState("Hi {{firstName}},\n\nBumping this...\n\n— {{senderName}}");

  const [s1BEnabled, setS1BEnabled] = useState<boolean>(false);
  const [s1BWeight, setS1BWeight] = useState<number>(50);
  const [s1BSubject, setS1BSubject] = useState("Saw {{company}} and had a thought");
  const [s1BBody, setS1BBody] = useState("Hi {{firstName}},\n\n...\n\n— {{senderName}}");

  const [s2BEnabled, setS2BEnabled] = useState<boolean>(false);
  const [s2BWeight, setS2BWeight] = useState<number>(50);
  const [s2BSubject, setS2BSubject] = useState("Re: following up");
  const [s2BBody, setS2BBody] = useState("Hi {{firstName}},\n\nJust checking...\n\n— {{senderName}}");

  // --- Leads ---
  const enrollableLeads = useMemo(() => {
    // keep the list small-ish; user can enroll later from the Enroll tab too
    return leads.slice(0, 250);
  }, [leads]);

  const [leadIds, setLeadIds] = useState<string[]>([]);

  // Populate IANA timezone options for a datalist. Uses Intl.supportedValuesOf when available.
  useEffect(() => {
    try {
      const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (resolved && !timezone) setTimezone(resolved);
    } catch {}

    const fallback = [
      "UTC",
      "Etc/UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
    try {
      const anyIntl: any = Intl as any;
      const zones: string[] = typeof anyIntl?.supportedValuesOf === "function" ? anyIntl.supportedValuesOf("timeZone") : [];
      setTzOptions((zones && zones.length ? zones : fallback).slice(0, 5000));
    } catch {
      setTzOptions(fallback);
    }
  }, []);

  // --- Resume existing draft (from Campaigns banner: /app/campaigns/new?resume=<id>) ---
  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setAutoSaveErr(null);

        // If we are not resuming, restore unsaved basics from localStorage
        if (!resumeCampaignId) {
          const lsName = typeof window !== "undefined" ? window.localStorage.getItem("cm_wizard_name") : null;
          const lsTz = typeof window !== "undefined" ? window.localStorage.getItem("cm_wizard_tz") : null;
          if (lsName && !name) setName(lsName);
          if (lsTz && !timezone) setTimezone(lsTz);
          return;
        }

        setBusy(true);
        const data = await fetch(`/api/campaigns/wizard/get?campaignId=${encodeURIComponent(resumeCampaignId)}`).then((r) => r.json());
        if (!alive) return;
        if (data?.error) throw new Error(data.error);

        const c = data?.campaign || {};
        setCampaignId(String(c.id));
        setName(String(c.name || ""));
        setTimezone(String(c.timezone || "Asia/Kolkata"));
        const sw = String(c.sendingWindow || "09:00-18:00");
        setSendingWindow(sw);
        {
          const m = sw.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
          if (m) {
            const norm = (t: string) => {
              const [hh, mm] = t.split(":");
              return `${String(hh).padStart(2, "0")}:${String(mm || "00").padStart(2, "0")}`;
            };
            setWindowStart(norm(m[1]));
            setWindowEnd(norm(m[2]));
          }
        }
        setDaysOfWeek(Array.isArray(c.daysOfWeek) && c.daysOfWeek.length ? c.daysOfWeek : [1, 2, 3, 4, 5]);
        const sa = c.startAt ? String(c.startAt).slice(0, 16) : "";
        const ea = c.endAt ? String(c.endAt).slice(0, 16) : "";
        setStartAt(sa);
        setEndAt(ea);
        if (sa && sa.includes("T")) {
          const [d, t] = sa.split("T");
          setStartAtDate(d);
          setStartAtTime(t);
        } else {
          setStartAtDate("");
          setStartAtTime("");
        }
        if (ea && ea.includes("T")) {
          const [d, t] = ea.split("T");
          setEndAtDate(d);
          setEndAtTime(t);
        } else {
          setEndAtDate("");
          setEndAtTime("");
        }

        setDailySendLimit(Number(c.dailySendLimit ?? 200));
        setRampEnabled(Boolean(c.rampEnabled));
        setRampStartLimit(Number(c.rampStartLimit ?? 20));
        setRampDailyIncrease(Number(c.rampDailyIncrease ?? 20));
        setRampMaxLimit(Number(c.rampMaxLimit ?? 200));
        setPerMailboxPerMinute(Number(c.perMailboxPerMinute ?? 20));
        setDomainDailyCap(Number(c.domainDailyCap ?? 25));
        setDomainCaps(String(c.domainCaps || ""));

        setGuardEnabled(Boolean(c.guardEnabled));
        setGuardWindowHours(Number(c.guardWindowHours ?? 24));
        setGuardMinSent(Number(c.guardMinSent ?? 50));
        setGuardMaxHardBounceRate(Number(c.guardMaxHardBounceRate ?? 0.05));
        setGuardMaxBounceRate(Number(c.guardMaxBounceRate ?? 0.08));
        setGuardMaxUnsubRate(Number(c.guardMaxUnsubRate ?? 0.02));

        setAutoThrottleEnabled(Boolean(c.autoThrottleEnabled));
        setAutoThrottleWindowMinutes(Number(c.autoThrottleWindowMinutes ?? 60));
        setAutoThrottleMinSent(Number(c.autoThrottleMinSent ?? 20));
        setAutoThrottleMaxHardBounceRate(Number(c.autoThrottleMaxHardBounceRate ?? 0.08));
        setAutoThrottleMaxBounceRate(Number(c.autoThrottleMaxBounceRate ?? 0.12));
        setAutoThrottleCooldownMinutes(Number(c.autoThrottleCooldownMinutes ?? 120));

        setStopOnReply(Boolean(c.stopOnReply));
        setStopOnBounce(Boolean(c.stopOnBounce));
        setStopOnUnsubscribe(Boolean(c.stopOnUnsubscribe));
        setStopOnOOO(Boolean(c.stopOnOOO));
        setStopKeywords(String(c.stopKeywords || ""));
        setNotInterestedKeywords(String(c.notInterestedKeywords || ""));
        setOooKeywords(String(c.oooKeywords || ""));

        {
          const ms = String(c.mailboxStrategy || "round_robin");
          const allowed = new Set(["round_robin", "random", "weighted", "least_recent"]);
          setMailboxStrategy((allowed.has(ms) ? ms : "round_robin") as any);
        }

        const sm = String(data.senderMode || "");
        const sender = sm === "pool" || sm === "all" || sm === "manual" ? sm : "manual";
        setSenderMode(sender as any);
        setMailboxPoolId(String(data.mailboxPoolId || ""));
        setMailboxIds(Array.isArray(data.mailboxIds) ? data.mailboxIds : []);

        // Steps
        if (data?.steps?.s1) {
          setS1Subject(String(data.steps.s1.subjectTpl || ""));
          setS1Body(String(data.steps.s1.bodyTpl || ""));
        }
        if (data?.steps?.s2) {
          setS2Delay(Number(data.steps.s2.delayDays ?? 2));
          setS2Subject(String(data.steps.s2.subjectTpl || ""));
          setS2Body(String(data.steps.s2.bodyTpl || ""));
        }

        const s1b = data?.steps?.s1b;
        setS1BEnabled(Boolean(s1b));
        if (s1b) {
          setS1BWeight(Number(s1b.weight ?? 50));
          setS1BSubject(String(s1b.subjectTpl || ""));
          setS1BBody(String(s1b.bodyTpl || ""));
        }

        const s2b = data?.steps?.s2b;
        setS2BEnabled(Boolean(s2b));
        if (s2b) {
          setS2BWeight(Number(s2b.weight ?? 50));
          setS2BSubject(String(s2b.subjectTpl || ""));
          setS2BBody(String(s2b.bodyTpl || ""));
        }

        // Draft lead selection (optional)
        setLeadIds(Array.isArray(data.draftLeadIds) ? data.draftLeadIds : []);

        const step = Math.max(0, Math.min(5, Number(c.setupStep ?? 0)));
        setActive(step);
        setLastSavedAt(new Date());

        // Persist last draft id in case user reloads
        if (typeof window !== "undefined") window.localStorage.setItem("cm_wizard_last_campaign", String(c.id));
      } catch (e: any) {
        if (alive) setErr(e?.message || String(e));
      } finally {
        if (alive) setBusy(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeCampaignId]);

  // Persist Basics to localStorage (so the user doesn't lose the name before the campaign is created)
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("cm_wizard_name", name);
  }, [name]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("cm_wizard_tz", timezone);
  }, [timezone]);

  const selectedMailboxCount = useMemo(() => {
    if (senderMode === "manual") return mailboxIds.length;
    if (senderMode === "pool") return pools.find((p) => p.id === mailboxPoolId)?.membersCount || 0;
    return mailboxes.filter((m) => m.isActive).length;
  }, [senderMode, mailboxIds, mailboxPoolId, pools, mailboxes]);
  const selectedLeadCount = leadIds.length;

  const timeOptions = useMemo(() => {
    const out: string[] = [];
    for (let mins = 0; mins < 24 * 60; mins += 15) {
      const hh = String(Math.floor(mins / 60)).padStart(2, "0");
      const mm = String(mins % 60).padStart(2, "0");
      out.push(`${hh}:${mm}`);
    }
    return out;
  }, []);

  const localNow = useMemo(() => {
    if (!mounted) return null;
    if (!timezone) return null;
    try {
      return new Date().toLocaleTimeString([], { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
    } catch {
      return null;
    }
  }, [timezone]);

  async function ensureCampaignCreated() {
    if (campaignId) return campaignId;
    const nm = name.trim();
    if (!nm) throw new Error("Please enter a campaign name.");
    const r = await postJson<{ campaignId: string }>("/api/campaigns/wizard/create", { name: nm });
    setCampaignId(r.campaignId);
    if (typeof window !== "undefined") window.localStorage.setItem("cm_wizard_last_campaign", r.campaignId);
    return r.campaignId;
  }

  async function saveSenders(id: string) {
    await postJson<{ ok: true }>("/api/campaigns/wizard/senders", {
      campaignId: id,
      senderMode,
      mailboxPoolId: mailboxPoolId || null,
      mailboxIds,
      mailboxStrategy,
    });
  }

  async function saveSettings(id: string) {
    await postJson<{ ok: true }>("/api/campaigns/wizard/settings", {
      campaignId: id,
      name: name.trim(),
      timezone,
      sendingWindow,
      daysOfWeek,
      startAt: startAt || null,
      endAt: endAt || null,
      dailySendLimit,
      rampEnabled,
      rampStartLimit,
      rampDailyIncrease,
      rampMaxLimit,
      perMailboxPerMinute,
      domainDailyCap,
      domainCaps: domainCaps.trim() || null,
      guardEnabled,
      guardWindowHours,
      guardMinSent,
      guardMaxHardBounceRate,
      guardMaxBounceRate,
      guardMaxUnsubRate,
      autoThrottleEnabled,
      autoThrottleWindowMinutes,
      autoThrottleMinSent,
      autoThrottleMaxHardBounceRate,
      autoThrottleMaxBounceRate,
      autoThrottleCooldownMinutes,
      // stop rules (combined for convenience)
      stopOnReply,
      stopOnBounce,
      stopOnUnsubscribe,
      stopOnOOO,
      stopKeywords: stopKeywords.trim() || null,
      notInterestedKeywords: notInterestedKeywords.trim() || null,
      oooKeywords: oooKeywords.trim() || null,
    });
  }

  async function saveSteps(id: string) {
    await postJson<{ ok: true }>("/api/campaigns/wizard/steps", {
      campaignId: id,
      s1: { subjectTpl: s1Subject, bodyTpl: s1Body, delayDays: 0, isReply: false },
      s1b: s1BEnabled ? { subjectTpl: s1BSubject, bodyTpl: s1BBody, weight: s1BWeight } : null,
      s2: { subjectTpl: s2Subject, bodyTpl: s2Body, delayDays: s2Delay, isReply: true },
      s2b: s2BEnabled ? { subjectTpl: s2BSubject, bodyTpl: s2BBody, weight: s2BWeight } : null,
    });
  }

  async function enrollNow(id: string) {
    if (!leadIds.length) return;
    await postJson<{ ok: true; enrolled: number }>("/api/campaigns/wizard/enroll", { campaignId: id, leadIds });
  }

  async function saveDraftLeads(id: string) {
    await postJson<{ ok: true }>("/api/campaigns/wizard/draftLeads", { campaignId: id, leadIds });
  }

  async function finalizeWizard(id: string) {
    await postJson<{ ok: true }>("/api/campaigns/wizard/finalize", { campaignId: id });
  }

  function triggerAutoSave(fn: () => Promise<void>) {
    if (!campaignId) return;
    if (busy) return;
    clearTimeout(autoSaveT.current);
    autoSaveT.current = setTimeout(async () => {
      try {
        setAutoSaving(true);
        setAutoSaveErr(null);
        await fn();
        setLastSavedAt(new Date());
      } catch (e: any) {
        setAutoSaveErr(e?.message || String(e));
      } finally {
        setAutoSaving(false);
      }
    }, 800);
  }

  // Autosave per step (debounced)
  useEffect(() => {
    if (!campaignId) return;
    if (active !== 1) return;
    triggerAutoSave(() => saveSenders(campaignId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, campaignId, mailboxStrategy, mailboxIds]);

  useEffect(() => {
    if (!campaignId) return;
    if (active !== 2) return;
    triggerAutoSave(() => saveSettings(campaignId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    campaignId,
    name,
    timezone,
    sendingWindow,
    daysOfWeek,
    startAt,
    endAt,
    dailySendLimit,
    rampEnabled,
    rampStartLimit,
    rampDailyIncrease,
    rampMaxLimit,
    perMailboxPerMinute,
    domainDailyCap,
    domainCaps,
    guardEnabled,
    guardWindowHours,
    guardMinSent,
    guardMaxHardBounceRate,
    guardMaxBounceRate,
    guardMaxUnsubRate,
    autoThrottleEnabled,
    autoThrottleWindowMinutes,
    autoThrottleMinSent,
    autoThrottleMaxHardBounceRate,
    autoThrottleMaxBounceRate,
    autoThrottleCooldownMinutes,
    stopOnReply,
    stopOnBounce,
    stopOnUnsubscribe,
    stopOnOOO,
    stopKeywords,
    notInterestedKeywords,
    oooKeywords,
  ]);

  useEffect(() => {
    if (!campaignId) return;
    if (active !== 3) return;
    triggerAutoSave(() => saveSteps(campaignId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, campaignId, s1Subject, s1Body, s1BEnabled, s1BSubject, s1BBody, s1BWeight, s2Subject, s2Body, s2Delay, s2BEnabled, s2BSubject, s2BBody, s2BWeight]);

  useEffect(() => {
    if (!campaignId) return;
    if (active !== 4) return;
    triggerAutoSave(() => saveDraftLeads(campaignId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, campaignId, leadIds]);

  async function next() {
    setErr(null);
    clearTimeout(autoSaveT.current);
    setBusy(true);
    try {
      if (active === 0) {
        await ensureCampaignCreated();
        setActive(1);
        return;
      }
      const id = await ensureCampaignCreated();

      if (active === 1) {
        await saveSenders(id);
        setLastSavedAt(new Date());
        setActive(2);
        return;
      }
      if (active === 2) {
        await saveSettings(id);
        setLastSavedAt(new Date());
        setActive(3);
        return;
      }
      if (active === 3) {
        await saveSteps(id);
        setLastSavedAt(new Date());
        setActive(4);
        return;
      }
      if (active === 4) {
        await saveDraftLeads(id);
        await enrollNow(id);
        setLastSavedAt(new Date());
        setActive(5);
        return;
      }
      if (active === 5) {
        await finalizeWizard(id);
        setLastSavedAt(new Date());
        try {
          if (typeof window !== "undefined") {
            window.localStorage.removeItem("cm_wizard_name");
            window.localStorage.removeItem("cm_wizard_tz");
          }
        } catch {}
        // finalize: go to campaign
        window.location.href = `/app/campaigns/${id}`;
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function back() {
    setErr(null);
    setActive((a) => Math.max(0, a - 1));
  }

  function toggleMailbox(id: string) {
    setMailboxIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleLead(id: string) {
    setLeadIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="max-w-5xl">
      <Card title="Create campaign (guided setup)">
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Stepper steps={steps} active={active} />
            <div className="text-xs flex items-center gap-2">
              {autoSaveErr ? <span className="text-red-500">Autosave failed</span> : null}
              {autoSaving ? (
                <span className="opacity-70">Saving…</span>
              ) : lastSavedAt ? (
                <span className="opacity-70">Saved {timeAgo(lastSavedAt)}</span>
              ) : campaignId ? (
                <span className="opacity-70">Not saved yet</span>
              ) : (
                <span className="opacity-70">Draft not created yet</span>
              )}
            </div>
          </div>

          {err ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm">
              <div className="font-semibold mb-1">Fix this</div>
              <div className="opacity-90 whitespace-pre-wrap">{err}</div>
            </div>
          ) : null}

          {/* Step content */}
          {active === 0 ? (
            <div className="grid gap-3">
              <div className="text-sm opacity-70">
                We’ll create a draft campaign and walk you through all settings in one flow.
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Campaign name</div>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SaaS founders outreach" />
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Timezone (IANA)</div>
                  <Input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="Asia/Kolkata"
                    list="cm_tz_list"
                  />
                  <datalist id="cm_tz_list">
                    {tzOptions.map((tz) => (
                      <option key={tz} value={tz} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
                Tip: You can always tweak details later, but this wizard makes sure your campaign is ready to run immediately.
              </div>
            </div>
          ) : null}

          {active === 1 ? (
            <div className="grid gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">Choose senders</div>
                  <div className="text-sm opacity-70">Select a sender mode, then choose a routing strategy.</div>
                </div>
                <Badge>{selectedMailboxCount} selected</Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSenderMode("manual")}
                  className={`px-3 py-2 rounded-xl border text-sm ${senderMode === "manual" ? "bg-slate-50/60 border-black/20 dark:border-white/20" : "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"}`}
                >
                  Select mailboxes
                </button>
                <button
                  type="button"
                  onClick={() => setSenderMode("pool")}
                  className={`px-3 py-2 rounded-xl border text-sm ${senderMode === "pool" ? "bg-slate-50/60 border-black/20 dark:border-white/20" : "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"}`}
                >
                  Use pool
                </button>
                <button
                  type="button"
                  onClick={() => setSenderMode("all")}
                  className={`px-3 py-2 rounded-xl border text-sm ${senderMode === "all" ? "bg-slate-50/60 border-black/20 dark:border-white/20" : "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10"}`}
                >
                  All active
                </button>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="md:col-span-2 rounded-2xl border border-slate-200 p-3">
                  {senderMode === "manual" ? (
                    <div className="grid gap-2">
                      {mailboxes.length === 0 ? (
                        <div className="text-sm opacity-70">No mailboxes found. Create a mailbox first.</div>
                      ) : null}
                      {mailboxes.map((m) => (
                        <label
                          key={m.id}
                          className="flex items-start gap-3 p-3 rounded-2xl border border-slate-200 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={mailboxIds.includes(m.id)}
                            onChange={() => toggleMailbox(m.id)}
                            className="mt-1"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold leading-tight flex items-center gap-2 flex-wrap">
                              {m.name} <Pill>{m.fromEmail}</Pill>
                              {!m.isActive ? <Pill>inactive</Pill> : null}
                            </div>
                            <div className="text-sm opacity-70">Daily limit: {m.dailyLimit}</div>
                          </div>
                        </label>
                      ))}
                      <div className="text-xs opacity-60 mt-1">If you select none, the campaign will use all active mailboxes.</div>
                    </div>
                  ) : null}

                  {senderMode === "pool" ? (
                    <div className="grid gap-3">
                      <div className="text-sm opacity-70">Pick a pool of mailboxes. You can manage pools in Mailboxes → Pools.</div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Pool</div>
                        <select
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-transparent"
                          value={mailboxPoolId}
                          onChange={(e) => setMailboxPoolId(e.target.value)}
                        >
                          <option value="">Select a pool…</option>
                          {pools.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.membersCount})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
                        Routing will use <span className="font-semibold">active members</span> of the pool. If the pool is empty, the campaign falls back to all active mailboxes.
                      </div>
                    </div>
                  ) : null}

                  {senderMode === "all" ? (
                    <div className="grid gap-2">
                      <div className="text-sm opacity-70">This campaign can send from all active mailboxes in your workspace.</div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
                        Active mailboxes: <span className="font-semibold">{mailboxes.filter((m) => m.isActive).length}</span>
                      </div>
                      <div className="text-xs opacity-60">Tip: Use Pools if you want to segment mailboxes by domain, IP, warmup stage, or customer.</div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-200 p-3">
                  <div className="font-semibold mb-2">Routing strategy</div>
                  <select
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-transparent"
                    value={mailboxStrategy}
                    onChange={(e) => setMailboxStrategy(e.target.value as any)}
                  >
                    <option value="round_robin">Round robin</option>
                    <option value="least_recent">Least recently used</option>
                    <option value="random">Random</option>
                    <option value="weighted" disabled={senderMode !== "pool"}>
                      Weighted (pool)
                    </option>
                  </select>

                  <div className="text-xs opacity-70 mt-2">
                    {mailboxStrategy === "weighted" ? (
                      <>Weighted routing uses the pool member weights you set (higher weight = more sends).</>
                    ) : mailboxStrategy === "least_recent" ? (
                      <>Least-recent prioritizes senders that haven’t sent for this campaign recently (great for balancing).</>
                    ) : mailboxStrategy === "random" ? (
                      <>Random is useful for very large pools; it can increase variance per sender.</>
                    ) : (
                      <>Round robin is usually best for predictable warming and even distribution.</>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {active === 2 ? (
            <div className="grid gap-4">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <div className="font-semibold">Schedule</div>
                  <div className="text-sm opacity-70">When should we send?</div>
                </div>
                <div className="flex justify-end">
                  <Badge>
                    Local time: {localNow ? `${localNow} · ` : ""}{timezone || "—"}
                  </Badge>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm mb-1 opacity-80">Sending window</div>
                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-xs opacity-70 mb-1">Start</div>
                        <select
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-transparent"
                          value={windowStart}
                          onChange={(e) => {
                            const v = e.target.value;
                            setWindowStart(v);
                            setSendingWindow(`${v}-${windowEnd}`);
                          }}
                        >
                          {timeOptions.map((t) => (
                            <option key={`ws_${t}`} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs opacity-70 mb-1">End</div>
                        <select
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-transparent"
                          value={windowEnd}
                          onChange={(e) => {
                            const v = e.target.value;
                            setWindowEnd(v);
                            setSendingWindow(`${windowStart}-${v}`);
                          }}
                        >
                          {timeOptions.map((t) => (
                            <option key={`we_${t}`} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Morning", v: "09:00-12:00" },
                        { label: "Business", v: "09:00-18:00" },
                        { label: "Evening", v: "16:00-20:00" },
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => {
                            setSendingWindow(p.v);
                            const m = p.v.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
                            if (m) {
                              setWindowStart(m[1]);
                              setWindowEnd(m[2]);
                            }
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                      <span className="text-xs opacity-60 self-center">{sendingWindow}</span>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">Start at (optional)</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="date"
                      value={startAtDate}
                      onChange={(e) => {
                        const d = e.target.value;
                        setStartAtDate(d);
                        if (!d) {
                          setStartAt("");
                          setStartAtTime("");
                          return;
                        }
                        const t = startAtTime || windowStart || "09:00";
                        setStartAtTime(t);
                        setStartAt(`${d}T${t}`);
                      }}
                    />
                    <select
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-transparent"
                      value={startAtTime}
                      onChange={(e) => {
                        const t = e.target.value;
                        setStartAtTime(t);
                        if (startAtDate) setStartAt(`${startAtDate}T${t}`);
                      }}
                      disabled={!startAtDate}
                    >
                      {timeOptions.map((t) => (
                        <option key={`sat_${t}`} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs opacity-70 mt-1">Leave empty to start immediately.</div>
                </div>
                <div>
                  <div className="text-sm mb-1 opacity-80">End at (optional)</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="date"
                      value={endAtDate}
                      onChange={(e) => {
                        const d = e.target.value;
                        setEndAtDate(d);
                        if (!d) {
                          setEndAt("");
                          setEndAtTime("");
                          return;
                        }
                        const t = endAtTime || windowEnd || "18:00";
                        setEndAtTime(t);
                        setEndAt(`${d}T${t}`);
                      }}
                    />
                    <select
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-transparent"
                      value={endAtTime}
                      onChange={(e) => {
                        const t = e.target.value;
                        setEndAtTime(t);
                        if (endAtDate) setEndAt(`${endAtDate}T${t}`);
                      }}
                      disabled={!endAtDate}
                    >
                      {timeOptions.map((t) => (
                        <option key={`eat_${t}`} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="text-xs opacity-70 mt-1">Leave empty for no end date.</div>
                </div>
              </div>

              <div>
                <div className="text-sm mb-2 opacity-80">Days of week</div>
                <div className="flex flex-wrap gap-2">
                  {weekdayLabels.map(([k, label]) => (
                    <label key={k} className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-slate-200 bg-slate-50/60">
                      <input
                        type="checkbox"
                        checked={daysOfWeek.includes(k)}
                        onChange={() =>
                          setDaysOfWeek((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
                        }
                      />
                      <span className="text-sm">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold mb-3">Limits & ramp-up</div>
                <div className="grid md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Daily send limit</div>
                    <Input type="number" min="0" value={dailySendLimit} onChange={(e) => setDailySendLimit(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Per mailbox / minute</div>
                    <Input type="number" min="1" value={perMailboxPerMinute} onChange={(e) => setPerMailboxPerMinute(Number(e.target.value || 1))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Per domain / day</div>
                    <Input type="number" min="1" value={domainDailyCap} onChange={(e) => setDomainDailyCap(Number(e.target.value || 1))} />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={rampEnabled} onChange={(e) => setRampEnabled(e.target.checked)} />
                    Enable ramp-up
                  </label>
                  {rampEnabled ? (
                    <div className="mt-3 grid md:grid-cols-3 gap-3">
                      <div>
                        <div className="text-sm mb-1 opacity-80">Start limit</div>
                        <Input type="number" min="1" value={rampStartLimit} onChange={(e) => setRampStartLimit(Number(e.target.value || 1))} />
                      </div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Daily increase</div>
                        <Input type="number" min="1" value={rampDailyIncrease} onChange={(e) => setRampDailyIncrease(Number(e.target.value || 1))} />
                      </div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Max limit</div>
                        <Input type="number" min="1" value={rampMaxLimit} onChange={(e) => setRampMaxLimit(Number(e.target.value || 1))} />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3">
                  <div className="text-sm mb-1 opacity-80">Domain caps map (optional JSON)</div>
                  <Input value={domainCaps} onChange={(e) => setDomainCaps(e.target.value)} placeholder='{"gmail.com":25,"yahoo.com":15}' />
                  <div className="text-xs opacity-70 mt-1">Leave empty to use only “Per domain / day”.</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold mb-3">Deliverability guardrails (auto-pause)</div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm opacity-70">Auto-pause if bounce/unsub thresholds are exceeded in a rolling window.</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={guardEnabled} onChange={(e) => setGuardEnabled(e.target.checked)} />
                    Enable
                  </label>
                </div>

                <div className="mt-3 grid md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Window (hours)</div>
                    <Input type="number" min="1" value={guardWindowHours} onChange={(e) => setGuardWindowHours(Number(e.target.value || 1))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Min sent</div>
                    <Input type="number" min="1" value={guardMinSent} onChange={(e) => setGuardMinSent(Number(e.target.value || 1))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Max hard bounce rate</div>
                    <Input type="number" step="0.01" min="0" max="1" value={guardMaxHardBounceRate} onChange={(e) => setGuardMaxHardBounceRate(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Max bounce rate</div>
                    <Input type="number" step="0.01" min="0" max="1" value={guardMaxBounceRate} onChange={(e) => setGuardMaxBounceRate(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Max unsub rate</div>
                    <Input type="number" step="0.01" min="0" max="1" value={guardMaxUnsubRate} onChange={(e) => setGuardMaxUnsubRate(Number(e.target.value || 0))} />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold mb-3">Auto-throttling (per mailbox)</div>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm opacity-70">If a mailbox spikes bounces, cooldown it automatically.</div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={autoThrottleEnabled} onChange={(e) => setAutoThrottleEnabled(e.target.checked)} />
                    Enable
                  </label>
                </div>

                <div className="mt-3 grid md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Window (minutes)</div>
                    <Input type="number" min="10" value={autoThrottleWindowMinutes} onChange={(e) => setAutoThrottleWindowMinutes(Number(e.target.value || 10))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Min sent</div>
                    <Input type="number" min="1" value={autoThrottleMinSent} onChange={(e) => setAutoThrottleMinSent(Number(e.target.value || 1))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Cooldown (minutes)</div>
                    <Input type="number" min="10" value={autoThrottleCooldownMinutes} onChange={(e) => setAutoThrottleCooldownMinutes(Number(e.target.value || 10))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Max hard bounce rate</div>
                    <Input type="number" step="0.01" min="0" max="1" value={autoThrottleMaxHardBounceRate} onChange={(e) => setAutoThrottleMaxHardBounceRate(Number(e.target.value || 0))} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Max bounce rate</div>
                    <Input type="number" step="0.01" min="0" max="1" value={autoThrottleMaxBounceRate} onChange={(e) => setAutoThrottleMaxBounceRate(Number(e.target.value || 0))} />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold mb-3">Stop rules</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stopOnReply} onChange={(e) => setStopOnReply(e.target.checked)} /> Stop on reply</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stopOnBounce} onChange={(e) => setStopOnBounce(e.target.checked)} /> Stop on bounce</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stopOnUnsubscribe} onChange={(e) => setStopOnUnsubscribe(e.target.checked)} /> Stop on unsubscribe</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={stopOnOOO} onChange={(e) => setStopOnOOO(e.target.checked)} /> Stop on OOO</label>
                </div>

                <div className="mt-3 grid md:grid-cols-3 gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Stop keywords</div>
                    <TextArea value={stopKeywords} onChange={(e) => setStopKeywords(e.target.value)} rows={4} placeholder="stop, remove me, do not contact" />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Not interested keywords</div>
                    <TextArea value={notInterestedKeywords} onChange={(e) => setNotInterestedKeywords(e.target.value)} rows={4} placeholder="not interested, no thanks" />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">OOO keywords</div>
                    <TextArea value={oooKeywords} onChange={(e) => setOooKeywords(e.target.value)} rows={4} placeholder="out of office, OOO" />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {active === 3 ? (
            <div className="grid gap-4">
              <div className="text-sm opacity-70">
                Variables:{" "}
                <code className="px-1 py-0.5 rounded-lg border border-slate-200 bg-slate-50/60">
                  {`{{firstName}} {{lastName}} {{email}} {{company}} {{website}} {{senderName}} {{senderEmail}}`}
                </code>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold mb-3">Step 1 (initial)</div>
                <div className="grid gap-3">
                  <div>
                    <div className="text-sm mb-1 opacity-80">Subject</div>
                    <Input value={s1Subject} onChange={(e) => setS1Subject(e.target.value)} />
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Body</div>
                    <TextArea value={s1Body} onChange={(e) => setS1Body(e.target.value)} rows={10} />
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={s1BEnabled} onChange={(e) => setS1BEnabled(e.target.checked)} />
                    Enable A/B Variant B
                  </label>

                  {s1BEnabled ? (
                    <div className="grid gap-3 rounded-2xl border border-slate-200 p-3 bg-slate-50/60">
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <div className="text-sm mb-1 opacity-80">Variant B Subject</div>
                          <Input value={s1BSubject} onChange={(e) => setS1BSubject(e.target.value)} />
                        </div>
                        <div>
                          <div className="text-sm mb-1 opacity-80">B traffic %</div>
                          <Input type="number" min="0" max="100" value={s1BWeight} onChange={(e) => setS1BWeight(Number(e.target.value || 0))} />
                        </div>
                      </div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Variant B Body</div>
                        <TextArea value={s1BBody} onChange={(e) => setS1BBody(e.target.value)} rows={8} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="font-semibold mb-3">Step 2 (follow-up reply)</div>
                <div className="grid gap-3">
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <div className="text-sm mb-1 opacity-80">Subject</div>
                      <Input value={s2Subject} onChange={(e) => setS2Subject(e.target.value)} />
                    </div>
                    <div>
                      <div className="text-sm mb-1 opacity-80">Delay (days)</div>
                      <Input type="number" min="0" value={s2Delay} onChange={(e) => setS2Delay(Number(e.target.value || 0))} />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm mb-1 opacity-80">Body</div>
                    <TextArea value={s2Body} onChange={(e) => setS2Body(e.target.value)} rows={10} />
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={s2BEnabled} onChange={(e) => setS2BEnabled(e.target.checked)} />
                    Enable A/B Variant B
                  </label>

                  {s2BEnabled ? (
                    <div className="grid gap-3 rounded-2xl border border-slate-200 p-3 bg-slate-50/60">
                      <div className="grid md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                          <div className="text-sm mb-1 opacity-80">Variant B Subject</div>
                          <Input value={s2BSubject} onChange={(e) => setS2BSubject(e.target.value)} />
                        </div>
                        <div>
                          <div className="text-sm mb-1 opacity-80">B traffic %</div>
                          <Input type="number" min="0" max="100" value={s2BWeight} onChange={(e) => setS2BWeight(Number(e.target.value || 0))} />
                        </div>
                      </div>
                      <div>
                        <div className="text-sm mb-1 opacity-80">Variant B Body</div>
                        <TextArea value={s2BBody} onChange={(e) => setS2BBody(e.target.value)} rows={8} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {active === 4 ? (
            <div className="grid gap-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">Enroll leads now (optional)</div>
                  <div className="text-sm opacity-70">Pick leads to enroll immediately. You can always enroll later.</div>
                </div>
                <Badge>{selectedLeadCount} selected</Badge>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3">
                <div className="grid gap-2 max-h-[420px] overflow-auto pr-1">
                  {enrollableLeads.length === 0 ? (
                    <div className="text-sm opacity-70">No enrollable leads found.</div>
                  ) : null}
                  {enrollableLeads.map((l) => (
                    <label
                      key={l.id}
                      className="flex items-start gap-3 p-3 rounded-2xl border border-slate-200 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <input type="checkbox" checked={leadIds.includes(l.id)} onChange={() => toggleLead(l.id)} className="mt-1" />
                      <div className="min-w-0">
                        <div className="font-semibold leading-tight">{l.email}</div>
                        <div className="text-sm opacity-70">
                          {(l.firstName || l.lastName) ? `${l.firstName || ""} ${l.lastName || ""}`.trim() : "—"}
                          {l.company ? ` • ${l.company}` : ""}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="text-xs opacity-70">
                Showing first {enrollableLeads.length} leads for performance. Use the Enroll tab for large selections.
              </div>
            </div>
          ) : null}

          {active === 5 ? (
            <div className="grid gap-3">
              <div className="font-semibold">Review</div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 p-3">
                  <div className="text-sm opacity-70 mb-2">Campaign</div>
                  <div className="font-semibold">{name || "—"}</div>
                  <div className="text-sm opacity-70 mt-1">{timezone}</div>
                  <div className="text-sm opacity-70 mt-1">
                    Window: {sendingWindow} • Days: {daysOfWeek.slice().sort().join(", ")}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-3">
                  <div className="text-sm opacity-70 mb-2">Senders & Leads</div>
                  <div className="text-sm">
                    <span className="opacity-70">Mailboxes:</span> {selectedMailboxCount}
                  </div>
                  <div className="text-sm">
                    <span className="opacity-70">Enroll now:</span> {selectedLeadCount}
                  </div>
                  <div className="text-sm opacity-70 mt-1">Strategy: {mailboxStrategy}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-3 text-sm opacity-70">
                Click <b>Finish</b> to open the campaign. You can press Start from the campaign page when you’re ready.
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" onClick={back} disabled={busy || active === 0}>
              Back
            </Button>

            <div className="flex items-center gap-2">
              {campaignId ? <Pill>Draft: {campaignId.slice(0, 8)}…</Pill> : null}
              <Button onClick={next} disabled={busy}>
                {active === 5 ? "Finish" : "Next"}
              </Button>
            </div>
          </div>

          {busy ? <div className="text-xs opacity-70">Saving…</div> : null}
        </div>
      </Card>
    </div>
  );
}
