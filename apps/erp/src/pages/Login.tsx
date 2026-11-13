import { Building2, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, Field, Input } from "@/components/ui";
import { useSession } from "@/lib/session";

export function LoginPage() {
  const { login, error: sessionError } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đăng nhập không thành công");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="from-navy-900 via-navy-800 to-brand-700 flex min-h-full items-center justify-center bg-gradient-to-br p-4">
      <form onSubmit={submit} className="shadow-2xl w-full max-w-sm rounded-xl bg-white p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="bg-navy-700 text-brand-500 flex size-11 items-center justify-center rounded-lg">
            <Building2 className="size-6" />
          </div>
          <div>
            <h1 className="text-lg text-navy-800 font-semibold">Quản lý Xây dựng</h1>
            <p className="text-xs text-slate-500">Hệ thống quản trị dự án & công trình</p>
          </div>
        </div>
        <div className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ten@congty.vn"
            />
          </Field>
          <Field label="Mật khẩu">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {(error || sessionError) && (
            <p className="bg-red-50 text-sm text-red-700 rounded-md px-3 py-2">{error || sessionError}</p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} Đăng nhập
          </Button>
          <p className="text-xs text-slate-500 text-center">
            Quên mật khẩu? Liên hệ bộ phận Nhân sự - Hành chính hoặc{" "}
            <a href="/accounts/forgot-password" className="text-brand-700 hover:underline">
              đặt lại qua email
            </a>
            .
          </p>
        </div>
      </form>
    </div>
  );
}
