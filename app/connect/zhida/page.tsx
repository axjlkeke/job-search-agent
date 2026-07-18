import type { Metadata } from "next";
import { ZhidaConnectCallback } from "./ZhidaConnectCallback";

export const metadata: Metadata = {
  title: { absolute: "连接职达主站｜求职Agent" },
  description: "安全完成职达主站资料与权益接力。",
};

export default function ZhidaConnectPage() {
  return <ZhidaConnectCallback />;
}
