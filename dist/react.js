'use client';

// src/client/react.ts
import { useEffect, useRef, useState } from "react";
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function useEmailLogin(client, options) {
  const [resumed] = useState(() => client.loadPendingLogin());
  const [step, setStep] = useState(resumed ? "code" : "email");
  const [email, setEmail] = useState(resumed?.email ?? "");
  const [challenge, setChallenge] = useState(resumed?.challenge ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [devCode, setDevCode] = useState(null);
  const [cooldown, setCooldown] = useState(
    () => resumed ? Math.max(0, 60 - Math.floor((Date.now() - resumed.at) / 1e3)) : 0
  );
  const codeRef = useRef(null);
  const verifying = useRef(false);
  const opts = useRef(options);
  opts.current = options;
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1e3);
    return () => clearTimeout(t);
  }, [cooldown]);
  const trimmed = email.trim();
  const emailOk = EMAIL_RE.test(trimmed);
  const fail = (message) => {
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
        const pending = client.loadPendingLogin();
        if (pending && pending.email === trimmed) {
          setChallenge(pending.challenge);
          setStep("code");
        }
      }
      fail(res.error ?? "Kh\xF4ng g\u1EEDi \u0111\u01B0\u1EE3c m\xE3");
      return;
    }
    opts.current.onSent?.();
    setChallenge(res.challenge);
    client.savePendingLogin({ email: trimmed, challenge: res.challenge, at: Date.now() });
    setNotice(res.warning ?? null);
    setDevCode(res.devCode ?? null);
    setCooldown(60);
    setCode("");
    setStep("code");
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
      setCode("");
      fail(res.error ?? "M\xE3 kh\xF4ng \u0111\xFAng");
      codeRef.current?.focus();
      return;
    }
    client.savePendingLogin(null);
    opts.current.onLogin({ token: res.token, user: res.user });
  };
  const typeCode = (raw) => {
    const v = raw.replace(/\D/g, "").slice(0, 6);
    setCode(v);
    if (v.length === 6) void verify(v);
  };
  const changeEmail = () => {
    setStep("email");
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
    codeRef
  };
}
export {
  useEmailLogin
};
