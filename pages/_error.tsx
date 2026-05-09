type ErrorPageProps = { statusCode?: number };

export default function ErrorPage({ statusCode }: ErrorPageProps) {
  const code = statusCode || 500;
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#020617", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <p style={{ letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.55 }}>{code}</p>
        <h1 style={{ fontSize: 32, margin: "12px 0" }}>Something went wrong</h1>
        <p style={{ opacity: 0.7 }}>Please try again or return to the dashboard.</p>
      </div>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }: any) => {
  const statusCode = res?.statusCode || err?.statusCode || 500;
  return { statusCode };
};
