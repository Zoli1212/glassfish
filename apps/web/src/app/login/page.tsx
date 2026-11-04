import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { currentUser } from '@/lib/auth';

export default async function LoginPage() {
  if (await currentUser()) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-block h-5 w-5 rounded-[6px]"
          style={{ background: 'var(--series-3)' }}
        />
        <span className="font-semibold">Glassfish Zero</span>
      </Link>

      <div className="card p-6">
        <h1 className="m-0 text-lg font-semibold">Sign in</h1>
        <p className="m-0 mt-1 mb-5 text-sm text-ink-2">Welcome back.</p>
        <AuthForm mode="login" />
      </div>

      <p className="mt-5 text-center text-sm text-ink-2">
        No account yet?{' '}
        <Link href="/register" className="font-medium text-brand underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
