import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/AuthForm';
import { currentUser, signupAllowed, userCount } from '@/lib/auth';
import { Notice } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  if (await currentUser()) redirect('/dashboard');

  const open = signupAllowed();
  const firstAccount = userCount() === 0;

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

      {open ? (
        <div className="card p-6">
          <h1 className="m-0 text-lg font-semibold">
            {firstAccount ? 'Claim this instance' : 'Create your account'}
          </h1>
          <p className="m-0 mt-1 mb-5 text-sm text-ink-2">
            {firstAccount
              ? 'No accounts exist yet. The first one becomes the owner, and registration closes automatically afterwards.'
              : "Accounts live in this instance's database — nothing leaves your server."}
          </p>
          <AuthForm mode="register" />
        </div>
      ) : (
        <Notice tone="info" title="Registration is closed on this instance.">
          This deployment already has an owner. Registration closed itself after the first
          account, so a public URL cannot be claimed by a stranger. An operator can re-open it by
          setting <code className="font-mono">GLASSFISH_ALLOW_SIGNUP=1</code>.
        </Notice>
      )}

      <p className="mt-5 text-center text-sm text-ink-2">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-brand underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
