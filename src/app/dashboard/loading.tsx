export default function DashboardLoading() {
  return (
    <div style={{ padding: "24px", maxWidth: "800px" }}>
      <div
        style={{
          height: "24px",
          width: "200px",
          backgroundColor: "#f0f0f0",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: "120px",
            backgroundColor: "#f5f5f5",
            borderRadius: "8px",
            marginBottom: "12px",
          }}
        />
      ))}
    </div>
  )
}
