import Link from "next/link";
import { Container, Input, Button } from "@/components/ui";

export default function TwoFactor({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const err = typeof searchParams?.err === "string" ? searchParams?.err : Array.isArray(searchParams?.err) ? searchParams?.err[0] : undefined;

  return (
    <Container>
      <div className="min-h-[75vh] flex items-center">
        <div className="w-full max-w-xl mx-auto relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/84 p-6 sm:p-8 shadow-[0_30px_100px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-indigo-600 via-violet-600 to-emerald-500" />
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-emerald-500 text-white flex items-center justify-center font-bold shadow-soft">
              🔐
            </div>
            <div>
              <div className="text-2xl font-display font-semibold tracking-tight">Two‑factor verification</div>
              <div className="text-sm text-slate-600 mt-0.5">Enter the 6‑digit code from your authenticator app.</div>
            </div>
          </div>

          {err ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm">❌ Invalid code. Try again.</div>
          ) : null}

          <form action="/api/auth/twofa/verify" method="post" className="mt-6 grid gap-4">
            <div>
              <div className="text-sm font-medium text-slate-700 mb-1">Authenticator code</div>
              <Input name="token" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
            </div>

            <div className="rounded-[1.4rem] border border-slate-200/80 bg-white/70 shadow-sm p-4">
              <div className="text-sm font-medium text-slate-900">Or use a recovery code</div>
              <div className="text-xs text-slate-600 mt-1">If you can’t access your authenticator, use one of your backup codes (each code can be used once).</div>
              <div className="mt-3">
                <Input name="recovery" placeholder="ABCD-EFGH-IJKL" className="font-mono" />
              </div>
            </div>

            <Button type="submit" className="w-full">Verify &amp; continue</Button>

            <div className="flex items-center justify-between text-xs text-slate-600">
              <Link href="/login" className="underline hover:text-slate-900">Back to login</Link>
              <Link href="/api/auth/logout?next=/login" className="underline hover:text-slate-900">Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </Container>
  );
}
