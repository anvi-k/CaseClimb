import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";

export default async function Home() {
  const u = await getUser();
  redirect(!u ? "/login" : u.role === "student" ? "/student" : "/faculty");
}
