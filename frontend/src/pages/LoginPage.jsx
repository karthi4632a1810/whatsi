import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, setToken } from "../api.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("reason") === "session-expired";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await api.login(email, password);
      setToken(data.token);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <section className="login-hero">
        <h1>MAPIMS Lab WhatsApp</h1>
        <p>
          Monitor HIS lab completion status and deliver approved reports to patients via
          WhatsApp — one calm operations screen for the lab team.
        </p>
      </section>
      <div className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <h2>Staff sign in</h2>
          <p className="muted">Use your MAPIMS staff credentials</p>
          {sessionExpired ? (
            <p className="success-banner" role="status">
              Your session expired. Please sign in again.
            </p>
          ) : null}
          <div className="form-row">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="you@mapims.edu.in"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-row">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button disabled={loading} type="submit">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
