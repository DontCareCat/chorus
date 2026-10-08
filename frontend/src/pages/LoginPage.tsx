import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { en } from "../i18n/en";
import { paths } from "../router";
import { ApiError } from "../services/api";

export function LoginPage() {
  const auth = useAuth();
  const first = auth.state?.first_account ?? false;
  const canRegister = first || (auth.state?.allow_registration ?? false);
  const [mode, setMode] = useState<"in" | "up">(first ? "up" : "in");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const up = mode === "up";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (up) await auth.signUp(username, password, displayName);
      else await auth.signIn(username, password);
      location.hash = paths.library();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : en.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <h1 id="auth-title">{up ? en.account.createTitle : en.account.signInTitle}</h1>
      <p className="muted" style={{ marginBottom: 24 }}>{up ? (first ? en.account.firstHelp : en.account.createHelp) : en.account.signInHelp}</p>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label className="field">
          <span>{en.account.username}</span>
          <input type="text" value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        {up && (
          <label className="field">
            <span>{en.account.displayName}</span>
            <input type="text" value={displayName} maxLength={64} onChange={(e) => setDisplayName(e.target.value)} />
            <small>{en.account.displayNameHelp}</small>
          </label>
        )}
        <label className="field">
          <span>{en.account.password}</span>
          <input type="password" value={password} autoComplete={up ? "new-password" : "current-password"} onChange={(e) => setPassword(e.target.value)} required />
          {up && <small>{en.account.passwordHelp}</small>}
        </label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button type="submit" className="btn large" disabled={busy || !username.trim() || !password}>{up ? en.account.create : en.account.signIn}</button>
      </form>
      <p className="alt">
        {up ? (
          <>{en.account.haveAccount} <a href="#/login" onClick={(e) => { e.preventDefault(); setMode("in"); setError(null); }}>{en.account.signIn}</a></>
        ) : (
          canRegister && <>{en.account.noAccount} <a href="#/login" onClick={(e) => { e.preventDefault(); setMode("up"); setError(null); }}>{en.account.create}</a></>
        )}
      </p>
      {auth.state?.allow_guest && (
        <p className="alt"><a href={paths.library()}>{en.account.continueAsGuest}</a></p>
      )}
    </section>
  );
}
