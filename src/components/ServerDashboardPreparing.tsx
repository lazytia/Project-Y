/**
 * SSR dashboard placeholder — inline styles so first HTML paint matches
 * system-yurica's "Preparing your dashboard…" card (no CSS bundle needed).
 */
export default function ServerDashboardPreparing() {
  return (
    <div
      id="ssr-dash-preparing"
      style={{
        display: "flex",
        minHeight: "60vh",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      <div
        style={{
          borderRadius: "24px",
          background: "#fff",
          padding: "40px 56px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            margin: "0 auto",
            borderRadius: "50%",
            border: "3px solid #f0f0f0",
            borderTopColor: "#111",
            animation: "ssrDashSpin 0.9s linear infinite",
          }}
          aria-hidden="true"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: "@keyframes ssrDashSpin{to{transform:rotate(360deg)}}",
          }}
        />
        <p
          style={{
            margin: "24px 0 0",
            fontFamily: "Arial,sans-serif",
            fontSize: "20px",
            fontWeight: 700,
            color: "#111",
          }}
        >
          Project Y
        </p>
        <p
          style={{
            margin: "8px 0 0",
            fontFamily: "Arial,sans-serif",
            fontSize: "14px",
            fontWeight: 500,
            color: "#6E6E73",
          }}
        >
          Preparing your dashboard…
        </p>
      </div>
    </div>
  );
}
