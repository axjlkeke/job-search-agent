import type { Metadata } from "next";
import { AgentWorkspace } from "./AgentWorkspace";

export const metadata: Metadata = {
  title: {
    absolute: "求职Agent｜央国企求职规划助手",
  },
  description:
    "面向学生的央国企求职规划工作台，用真实依据拆解目标、计划与下一步行动。",
};

export default function Home() {
  return <AgentWorkspace />;
}
