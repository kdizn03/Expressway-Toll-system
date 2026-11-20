"use client";
import { useEffect, useState } from "react";

type User = { fullName: string; role: "USER" | "ADMIN" } | null;
export function AuthLinks() {
  const [user, setUser] = useState<User>(null);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { fetch("/api/auth/session").then((response) => response.json()).then((body) => { setEnabled(Boolean(body.authEnabled)); setUser(body.user ?? null); }).catch(() => undefined); }, []);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }
  if (!enabled) return null;
  if (!user) return <><a href="/login">Log in</a><a className="navAction" href="/register">Create account</a></>;
  return <><a href="/account">Account</a>{user.role === "ADMIN" && <a href="/admin">Admin</a>}<button className="navButton" onClick={logout}>Log out</button></>;
}
