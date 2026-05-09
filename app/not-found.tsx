export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-3">
        <p className="text-sm uppercase tracking-[0.3em] text-white/50">404</p>
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <p className="text-white/60">The page you are looking for does not exist or has moved.</p>
      </div>
    </main>
  );
}
