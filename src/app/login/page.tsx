"use client";

import { useEffect, useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  // Set when another page redirected here, which is the case worth explaining.
  const [cameFromSomewhere, setCameFromSomewhere] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    setCameFromSomewhere(Boolean(next));
  }, []);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "Could not sign in");
        return;
      }

      // Read the intended destination from the URL the middleware set.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setError("Could not reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="w-full max-w-sm px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
          Project Claudinho
        </p>
        <h1 className="display mt-2 text-4xl leading-none text-black dark:text-zinc-50">
          Sign in
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Your product research and rubric live behind here.
        </p>

        {/*
          Say why you are here.

          Being bounced to a password box with no explanation reads as the site
          being broken — "I cannot click anything" — rather than as a session
          that ended. It ends for two reasons and both are worth naming,
          because one of them is the thing you just did: the cookie holds a
          hash of the password, so changing the password signs everyone out.
        */}
        {cameFromSomewhere && (
          <p className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            You were signed out, so that page sent you here. It happens after
            thirty days, or straight away if the site password was changed —
            the sign-in cookie is tied to it.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={pending || password.length === 0}
            className="w-full rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-black"
          >
            {pending ? "Checking…" : "Sign in"}
          </button>
          {error && (
            <p className="rounded border border-red-300 bg-red-50 p-2.5 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100">
              {error}
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
