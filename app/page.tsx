import type { Metadata } from "next";
import { AgentWorkspace } from "./AgentWorkspace";

export const metadata: Metadata = {
  title: {
    absolute: "求职Agent｜央国企求职规划助手",
  },
  description:
    "填写个人资料，与基于真实岗位和知识库的央国企求职顾问直接对话。",
};

export default function Home() {
  return <AgentWorkspace variant="studio" />;
}
