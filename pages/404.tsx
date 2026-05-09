export default function Custom404() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#020617", color: "white", padding: 24 }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <p style={{ letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.55 }}>404</p>
        <h1 style={{ fontSize: 32, margin: "12px 0" }}>Page not found</h1>
        <p style={{ opacity: 0.7 }}>The page you are looking for does not exist or has moved.</p>
      </div>
    </main>
  );
}
