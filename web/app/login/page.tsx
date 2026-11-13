import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "Inloggen · Jaarverslagen zorg" };

export default function Login() {
  return <LoginForm />;
}
