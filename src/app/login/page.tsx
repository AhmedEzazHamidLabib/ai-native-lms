import { AuthForm } from "./auth-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const role = params.role === "instructor" ? "instructor" : "student";
  const mode = params.mode === "signup" ? "signup" : "signin";

  return (
    <main className="flex-1 flex items-center justify-center px-6 py-16">
      <AuthForm initialRole={role} initialMode={mode} />
    </main>
  );
}
