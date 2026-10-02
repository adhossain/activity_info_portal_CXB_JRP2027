import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useAuth } from "../lib/auth-context.js";

const STEPS: { text: ReactNode; img: string; alt: string }[] = [
  {
    text: (
      <>
        Log in to{" "}
        <a href="https://www.activityinfo.org" target="_blank" rel="noreferrer">ActivityInfo</a> with your
        email.
      </>
    ),
    img: "/help/1-login.png",
    alt: "ActivityInfo log-in page asking for your email",
  },
  {
    text: (
      <>
        Click your name at the top right and choose <strong>Account settings</strong>.
      </>
    ),
    img: "/help/2-account-settings.jpg",
    alt: "Menu under your name with Account settings highlighted",
  },
  {
    text: (
      <>
        Open <strong>API Tokens</strong> and click <strong>Add</strong>.
      </>
    ),
    img: "/help/3-api-tokens.png",
    alt: "Account settings with API Tokens and the Add button highlighted",
  },
  {
    text: (
      <>
        Give the token any name, choose <strong>Read &amp; Write</strong> (a read-only token cannot save
        records) and click <strong>Generate</strong>.
      </>
    ),
    img: "/help/4-generate.png",
    alt: "Add token dialog with Read & Write selected",
  },
  {
    text: (
      <>
        Click <strong>Copy to clipboard</strong> and paste the token into the <strong>API Token</strong> box
        above. It would be helpful to save the token somewhere secure (for example a password manager), so
        you do not have to generate a new one every time. Keep it private: anyone with the token can act as
        you in ActivityInfo. If it is ever exposed, revoke it on the same page.
      </>
    ),
    img: "/help/5-copy.png",
    alt: "New token with the Copy to clipboard button highlighted",
  },
];

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-column">
        <div className="card disclaimer" role="note">
          <div className="disclaimer-title">Disclaimer</div>
          <p>
            This platform is developed by an independent self-taught tech enthusiast and is not affiliated with
            ActivityInfo or any other organisation. Data accuracy is not guaranteed; please verify all entries
            in ActivityInfo before submission. The developer is not liable for any errors. No data is stored in
            this platform's own database. Your API token and data are exchanged directly with ActivityInfo.
          </p>
          <p>
            The platform is hosted on the developer’s personal home server, making uptime dependent on the
            internet connection, electricity supply, and occasional interference from his four-year-old son.
          </p>
          <p className="disclaimer-sign">
            --- Adnan
            <br />
            Contact: <a href="mailto:admin@adhossain.xyz">admin@adhossain.xyz</a>
          </p>
        </div>

        <div className="card login-card">
          <h1>ActivityInfo Portal</h1>
          <p>Sign in with your ActivityInfo email and API token.</p>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="form-group">
              <label htmlFor="token">API Token</label>
              <input
                id="token"
                type="password"
                required
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Your personal API token"
              />
              <div className="field-help">
                Don't have one? <a href="#token-help">See how to get your API token</a>.
              </div>
            </div>
            {error && <div className="error-msg">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <section id="token-help" className="card token-help">
          <h2>How to get your API token</h2>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s.img}>
                <div className="step-num">{i + 1}</div>
                <div className="step-body">
                  <p>{s.text}</p>
                  <img src={s.img} alt={s.alt} loading="lazy" />
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
