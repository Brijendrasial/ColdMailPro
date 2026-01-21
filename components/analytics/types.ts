export type AnalyticsRangeKey = "7d" | "30d" | "90d" | "custom";

export type AnalyticsSummary = {
  range: {
    from: string; // ISO
    to: string; // ISO
    days: number;
  };
  filters: {
    campaigns: { id: string; name: string }[];
    mailboxes: { id: string; name: string; fromEmail: string }[];
  };
  kpis: {
    sent: number;
    opens: number;
    clicks: number;
    replies: number;
    bounces: number;
    unsubscribes: number;
    leadsAdded: number;
    leadsContacted: number; // distinct leads that got a "sent" event
    enrollments: number;
    openRate: number;
    replyRate: number;
    bounceRate: number;
    unsubRate: number;
  };
  timeseries: {
    days: string[]; // YYYY-MM-DD
    sent: number[];
    opens: number[];
    clicks: number[];
    replies: number[];
    bounces: number[];
    unsubscribes: number[];
  };
  top: {
    campaignsByReplies: { id: string; name: string; replies: number; sent: number }[];
    mailboxesByReplies: { id: string; name: string; fromEmail: string; replies: number; sent: number; bounces: number }[];
  };
  heatmap: {
    // 7 rows (Mon..Sun), 24 columns
    replies: number[][];
    sent: number[][];
  };
  funnel: {
    leadsAdded: number;
    enrolled: number;
    contacted: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
  };
  recent: {
    id: string;
    type: string;
    createdAt: string;
    campaignName?: string | null;
    mailboxFrom?: string | null;
    leadEmail?: string | null;
    subject?: string | null;
  }[];
  insights: { tone: "info" | "success" | "warning" | "danger"; title: string; detail: string }[];
};
