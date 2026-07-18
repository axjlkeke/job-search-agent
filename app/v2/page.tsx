import type { Metadata } from "next";
import { AgentWorkspace } from "../AgentWorkspace";

export const metadata: Metadata = {
  title: {
    absolute: "求职Agent新版｜央国企求职策略工作台",
  },
  description:
    "从学生建档、在招岗位到策略网络和七日行动的央国企求职策略工作台。",
};

export default function CareerAgentStudioPage() {
  return <AgentWorkspace variant="studio" />;
}
