'use client';
import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="card space-y-4">
      {state?.error ? <div className="notice notice-error">{state.error}</div> : null}
      <div>
        <label className="label" htmlFor="email">
          電子郵件
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">
          密碼
        </label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn btn-primary w-full justify-center" disabled={pending}>
        {pending ? '登入中…' : '登入'}
      </button>
    </form>
  );
}
