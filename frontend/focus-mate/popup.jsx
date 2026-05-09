import { useState } from "react"

const API_BASE = "http://localhost:8000" // Updated to match backend port

function IndexPopup() {
  // Just to test the backend
  const [root, setRoot] = useState(null) // Root call
  const [users, setUsers] = useState(null) // List users call
  const [rootError, setRootError] = useState(null)
  const [usersError, setUsersError] = useState(null)

  const testBackend = async () => {
    setRootError(null)
    setUsersError(null)

    try {
      const r = await fetch(`${API_BASE}/`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setRoot(await r.json())
    } catch (e) {
      setRoot(null)
      setRootError(e instanceof Error ? e.message : String(e))
    }

    try {
      const r = await fetch(`${API_BASE}/users`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setUsers(await r.json())
    } catch (e) {
      setUsers(null)
      setUsersError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ padding: 16, minWidth: 320, fontFamily: "sans-serif" }}>
      <h2>Backend connection test</h2>

      <button onClick={testBackend} style={{ marginBottom: 12 }}>
        Test backend
      </button>

      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "8px 0" }}>GET /</h3>
        {rootError ? (
          <pre style={{ color: "crimson" }}>Error: {rootError}</pre>
        ) : root ? (
          <pre>{JSON.stringify(root, null, 2)}</pre>
        ) : (
          <p></p>
        )}
      </section>

      <section>
        <h3 style={{ margin: "8px 0" }}>GET /users</h3>
        {usersError ? (
          <pre style={{ color: "crimson" }}>Error: {usersError}</pre>
        ) : users ? (
          <pre>{JSON.stringify(users, null, 2)}</pre>
        ) : (
          <p></p>
        )}
      </section>
    </div>
  )
}

export default IndexPopup