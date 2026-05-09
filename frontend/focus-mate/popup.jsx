import "./style.css"

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
    <div className="p-4 min-w-[320px] font-sans">
      <h1 className="text-red-500 text-lg font-semibold mb-2">
        Backend connection test
      </h1>

      <button
        onClick={testBackend}
        className="mb-3 px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">
        Test backend
      </button>

      <section className="mb-4">
        <h3 className="my-2 font-medium">GET /</h3>
        {rootError ? (
          <pre className="text-red-700">Error: {rootError}</pre>
        ) : root ? (
          <pre>{JSON.stringify(root, null, 2)}</pre>
        ) : (
          <p></p>
        )}
      </section>

      <section>
        <h3 className="my-2 font-medium">GET /users</h3>
        {usersError ? (
          <pre className="text-red-700">Error: {usersError}</pre>
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
