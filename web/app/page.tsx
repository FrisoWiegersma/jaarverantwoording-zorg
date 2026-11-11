import { ViewTransition } from "react";
import { ChatPage } from "@/components/chat";

// Each page fades in and rises a little on navigation (.page in globals.css); see the Next.js view transitions guide.
export default function Page() { return <ViewTransition default="none" enter="page" exit="page"><ChatPage /></ViewTransition>; }
