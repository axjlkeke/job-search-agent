import assert from "node:assert/strict";
import test from "node:test";
import { normalizeZhidaProduct } from "../lib/server/zhida-products.ts";

test("normalizes public products without exposing unbounded upstream fields", () => {
  const product = normalizeZhidaProduct({
    id: 1,
    name: " VIP 会员 ",
    slug: "vip",
    description: "岗位推送与简历优化",
    grantLevel: "vip",
    monthlyPrice: "59.90",
    quarterlyPrice: "159.90",
    yearlyPrice: "599.00",
    lifetimePrice: "not-a-price",
    features: [
      { icon: "ignored", title: "简历优化", description: "每日可用" },
      { title: "" },
    ],
    highlights: ["推荐", "推荐", "求职支持"],
    isRecommended: true,
    internalNote: "must not be forwarded",
  });

  assert.deepEqual(product, {
    id: "1",
    name: "VIP 会员",
    slug: "vip",
    description: "岗位推送与简历优化",
    grantLevel: "vip",
    monthlyPrice: "59.90",
    quarterlyPrice: "159.90",
    yearlyPrice: "599.00",
    lifetimePrice: null,
    features: [{ title: "简历优化", description: "每日可用" }],
    highlights: ["推荐", "求职支持"],
    isRecommended: true,
    purchaseUrl: "https://www.zhidasihai.cn/pricing/vip",
  });
});

test("rejects products with unsafe slugs or unsupported access levels", () => {
  assert.equal(
    normalizeZhidaProduct({
      id: 2,
      name: "坏链接",
      slug: "../../admin",
      grantLevel: "vip",
    }),
    null,
  );

  assert.equal(
    normalizeZhidaProduct({
      id: 3,
      name: "未知级别",
      slug: "unknown",
      grantLevel: "root",
    }),
    null,
  );
});
