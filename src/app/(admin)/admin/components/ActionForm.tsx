'use client';
import { useActionState, type ReactNode } from 'react';

type R = { ok: true; message?: string } | { ok: false; error: string } | undefined;

/** Small wrapper: a <form> bound to a server action that returns {ok, message|error}. */
export function ActionForm({
  action,
  children,
  className,
  submit = '儲存',
  resetOnSuccess,
}: {
  action: (prev: unknown, form: FormData) => Promise<any>;
  children: ReactNode;
  className?: string;
  submit?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, run, pending] = useActionState<R, FormData>(action as any, undefined);
  return (
    <form
      action={run}
      className={className}
      key={resetOnSuccess && state?.ok ? Math.random() : undefined}
    >
      {state ? <div className={`notice ${state.ok ? '' : 'notice-error'}`}>{state.ok ? state.message || '已儲存' : state.error}</div> : null}
      {children}
      <button className="btn btn-primary mt-3" disabled={pending}>
        {pending ? '處理中…' : submit}
      </button>
    </form>
  );
}
