/**
 * The login form's behaviour without its markup, so every game keeps its own
 * look: email step → code step, resume after the mail app reloaded the tab,
 * resend cooldown, auto-submit at 6 digits, and the dev-mode code shortcut.
 */

import { useEffect, useRef, useState } from 'react';
import type { AuthClient, Session } from './index';

export interface EmailLoginOptions {
  onLogin: (session: Session) => void;
  /** A code went out — a good moment for a sound. */
  onSent?: () => void;
  /** Sending or verifying failed. */
  onError?: (message: string) => void;
}

export interface EmailLogin {
  step: 'email' | 'code';
  email: string;
  setEmail: (email: string) => void;
  /** whether `email` looks like an address, for disabling the send button */
  emailOk: boolean;
  code: string;
  /** Feed it the raw input value: keeps the digits and submits at six. */
  typeCode: (raw: string) => void;
  busy: boolean;
  error: string | null;
  /** e.g. "mail is slow" — not an error */
  notice: string | null;
  /** set when the server has no mail provider (local dev); `verify(devCode)` logs straight in */
  devCode: string | null;
  /** seconds until "resend" is allowed */
  cooldown: number;
  send: () => Promise<void>;
  verify: (value?: string) => Promise<void>;
  changeEmail: () => void;
  /** attach to the code input so it gets focus when the code step opens */
  codeRef: { current: HTMLInputElement | null };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function useEmailLogin(client: AuthClient, options: EmailLoginOptions): EmailLogin {
  // Coming back from the mail app may have reloaded the page: resume at the code step.
  const [resumed] = useState(() => client.loadPendingLogin());
  const [step, setStep] = useState<'email' | 'code'>(resumed ? 'code' : 'email');
  const [email, setEmail] = useState(resumed?.email ?? '');
  const [challenge, setChallenge] = useState(resumed?.challenge ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(() =>
    resumed ? Math.max(0, 60 - Math.floor((Date.now() - resumed.at) / 1000)) : 0,
  );
  const codeRef = useRef<HTMLInputElement | null>(null);
  // Autofill and a quick Enter can both fire; only one verify may be in flight.
  const verifying = useRef(false);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const trimmed = email.trim();
  const emailOk = EMAIL_RE.test(trimmed);

  const fail = (message: string) => {
    setError(message);
    opts.current.onError?.(message);
  };

  const send = async () => {
    if (!emailOk || busy) return;
    setBusy(true);
    setError(null);
    const res = await client.requestLoginCode(trimmed);
    setBusy(false);
    if (!res.ok || !res.challenge) {
      if (res.retryIn) {
        setCooldown(res.retryIn);
        // A code for this address is already on its way — go and type it in,
        // but only if we still hold its challenge; otherwise wait out the cooldown.
        const pending = client.loadPendingLogin();
        if (pending && pending.email === trimmed) {
          setChallenge(pending.challenge);
          setStep('code');
        }
      }
      fail(res.error ?? 'Không gửi được mã');
      return;
    }
    opts.current.onSent?.();
    setChallenge(res.challenge);
    client.savePendingLogin({ email: trimmed, challenge: res.challenge, at: Date.now() });
    setNotice(res.warning ?? null);
    setDevCode(res.devCode ?? null);
    setCooldown(60);
    setCode('');
    setStep('code');
    setTimeout(() => codeRef.current?.focus(), 50);
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(null);
    const res = await client.verifyLoginCode(trimmed, value, challenge);
    verifying.current = false;
    setBusy(false);
    if (!res.ok || !res.token || !res.user) {
      setCode('');
      fail(res.error ?? 'Mã không đúng');
      codeRef.current?.focus();
      return;
    }
    client.savePendingLogin(null);
    opts.current.onLogin({ token: res.token, user: res.user });
  };

  const typeCode = (raw: string) => {
    const v = raw.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    if (v.length === 6) void verify(v);
  };

  const changeEmail = () => {
    setStep('email');
    setError(null);
    setNotice(null);
    setDevCode(null);
    client.savePendingLogin(null);
  };

  return {
    step,
    email,
    setEmail,
    emailOk,
    code,
    typeCode,
    busy,
    error,
    notice,
    devCode,
    cooldown,
    send,
    verify,
    changeEmail,
    codeRef,
  };
}
