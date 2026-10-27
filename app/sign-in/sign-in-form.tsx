'use client';

import { useEffect, useState } from 'react';

async function readJson(response: Response): Promise<{ error?: string }> {
  const text = await response.text();
  try {
    const result: unknown = JSON.parse(text);
    if (result && typeof result === 'object') return result as { error?: string };
  } catch {
    // Use a readable message when the host returns an HTML or empty error page.
  }
  return {
    error: response.status === 413
      ? 'That request is too large to process.'
      : response.status >= 500
        ? 'The server took too long. Please try again.'
        : 'Something went wrong. Please try again.',
  };
}

export default function SignInForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  async function submit(verify: boolean) {
    if (!verify) setCode('');
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const response = await fetch(`/api/auth/${verify ? 'verify' : 'code'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verify ? { email, code } : { email }),
      });
      const result = await readJson(response);
      if (!response.ok || result.error) throw new Error(result.error || 'Please try again.');
      if (verify) {
        window.location.assign('/');
        return;
      }
      setSent(true);
      setResendSeconds(60);
      setNotice('Code sent. Check your work inbox and spam folder.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="email-sign-in" onSubmit={(event) => { event.preventDefault(); void submit(sent); }}>
      <label>
        Work email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          disabled={busy || sent || !configured}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@cgi.com"
        />
      </label>
      {sent && (
        <label>
          Email verification code
          <input
            type="text"
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            minLength={6}
            maxLength={8}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
        </label>
      )}
      {error && <p className="message error" role="alert">{error}</p>}
      {notice && <p role="status" className="message success">{notice}</p>}
      <button className="primary" disabled={busy || !configured}>
        {busy ? 'Connecting…' : sent ? 'Verify & enter contest' : 'Send sign-in code'}
      </button>
      {sent && (
        <div className="button-row">
          <button type="button" disabled={busy || resendSeconds > 0} onClick={() => void submit(false)}>
            {resendSeconds > 0 ? `Resend code (${resendSeconds}s)` : 'Resend code'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode('');
              setResendSeconds(0);
              setNotice('');
              setError('');
            }}
          >
            Change email
          </button>
        </div>
      )}
      {!configured && <p role="status" className="muted">Email sign-in will be available once the hosting account is connected.</p>}
    </form>
  );
}
