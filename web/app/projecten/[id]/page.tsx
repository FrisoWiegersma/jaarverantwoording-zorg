import { Suspense } from "react";
import { ProjectWorkspace } from "@/components/project-workspace";

async function Workspace({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectWorkspace id={(await params).id} />;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<p className="p-8">Project laden…</p>}><Workspace params={params} /></Suspense>;
}
