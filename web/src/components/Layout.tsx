import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";

export function Layout({ children }: { children: ReactNode }) {
  const { email, logout } = useAuth();

  return (
    <>
      <header className="header">
        <div className="container header-inner">
          <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
            <h1>ActivityInfo Portal</h1>
          </Link>
          <div className="header-right">
            <span>{email}</span>
            <button className="btn btn-sm" onClick={() => logout()}>
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
