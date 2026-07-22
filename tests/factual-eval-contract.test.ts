import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type FactualCase = {
  id: string;
  target?: { companies?: string[] };
  expectedStatus: number;
  expectedAvailable: boolean;
  expectedCitationUrlIncludes?: string;
  requiredCitationUrlIncludes?: string[];
  minimumCitationCount?: number;
  allowedCitationHosts?: string[];
  expectedErrorCode?: string;
  requiredAnswerTerms?: string[];
  requiredAnswerAnyOf?: string[][];
  forbiddenAnswerTerms?: string[];
  scopedClaimGuards?: Array<{
    subjectTerms: string[];
    claimTerm: string;
    requiredQualifierTerms: string[];
  }>;
};

const suite = JSON.parse(
  readFileSync(new URL("../evals/advisor-factual-cases.json", import.meta.url), "utf8"),
) as { version: string; cases: FactualCase[] };

test("factual advisor suite covers hard thresholds, source isolation, timeliness, recovered evidence, and rejection", () => {
  assert.equal(suite.version, "2026-07-18-v8");
  assert.ok(suite.cases.length >= 17);
  assert.equal(new Set(suite.cases.map((item) => item.id)).size, suite.cases.length);

  const positives = suite.cases.filter((item) => item.expectedStatus === 200);
  assert.ok(positives.length >= 8);
  const allowedOfficialHosts = new Set([
    "www.sasac.gov.cn",
    "www.sinopecgroup.com",
    "www.crrcgc.cc",
    "www.ceeic.ceec.net.cn",
  ]);
  for (const item of positives) {
    assert.equal(item.expectedAvailable, true);
    const citationUrls = [
      ...(item.expectedCitationUrlIncludes
        ? [item.expectedCitationUrlIncludes]
        : []),
      ...(item.requiredCitationUrlIncludes ?? []),
    ];
    assert.ok(citationUrls.length >= 1);
    assert.ok(
      citationUrls.every(
        (value) =>
          /^\/c\d+\/content\.html$/u.test(value) ||
          value === "/group/000/000/068/68692.shtml" ||
          value ===
            "/ckgf/2025-08/28/article_2025082815514945773.html" ||
          value === "/art/2025/9/30/art_9793_2514532.html",
      ),
    );
    assert.ok((item.minimumCitationCount ?? 0) >= 1);
    assert.ok((item.allowedCitationHosts?.length ?? 0) >= 1);
    assert.ok(
      item.allowedCitationHosts?.every((host) => allowedOfficialHosts.has(host)),
    );
    assert.ok((item.requiredAnswerTerms?.length ?? 0) >= 3);
    assert.ok((item.target?.companies?.length ?? 0) >= 1);
  }

  const timeliness = suite.cases.find(
    (item) => item.id === "sasac-2026-expired-hard-thresholds",
  );
  assert.ok(timeliness?.requiredAnswerTerms?.includes("已截止"));

  const multiSource = suite.cases.find(
    (item) => item.id === "china-telecom-two-programs-source-isolation",
  );
  assert.ok((multiSource?.requiredCitationUrlIncludes?.length ?? 0) >= 2);
  assert.ok((multiSource?.minimumCitationCount ?? 0) >= 2);
  assert.ok((multiSource?.scopedClaimGuards?.length ?? 0) >= 1);

  const nearName = suite.cases.find(
    (item) => item.id === "casc-2027-early-batch-near-name-isolation",
  );
  assert.ok(nearName);
  assert.deepEqual(nearName.target?.companies, ["中国航天科技集团"]);
  assert.ok(
    nearName.requiredCitationUrlIncludes?.includes("/c35517299/content.html"),
  );
  assert.ok(nearName.requiredAnswerTerms?.includes("www.spacetalent.com.cn"));
  assert.ok(nearName.forbiddenAnswerTerms?.includes("航天科工"));

  const reverseNearName = suite.cases.find(
    (item) => item.id === "casic-2027-campus-near-name-reverse-isolation",
  );
  assert.ok(reverseNearName);
  assert.deepEqual(reverseNearName.target?.companies, ["中国航天科工集团"]);
  assert.ok(
    reverseNearName.requiredCitationUrlIncludes?.includes("/c35503679/content.html"),
  );
  assert.ok(reverseNearName.requiredAnswerTerms?.includes("casicjob.iguopin.com"));
  assert.ok(reverseNearName.forbiddenAnswerTerms?.includes("航天科技"));

  const socialRecruitment = suite.cases.find(
    (item) => item.id === "csg-shared-2026-expired-social-thresholds",
  );
  assert.ok(socialRecruitment);
  assert.ok(
    socialRecruitment.requiredAnswerTerms?.includes("大学本科及以上学历"),
  );
  assert.ok(
    socialRecruitment.requiredAnswerTerms?.includes("本科毕业后工作满3年"),
  );
  assert.ok(socialRecruitment.requiredAnswerTerms?.includes("已截止"));

  const campusRecruitment = suite.cases.find(
    (item) => item.id === "cctc-2026-campus-audience-major-benefits-process",
  );
  assert.ok(campusRecruitment);
  assert.ok(
    campusRecruitment.requiredAnswerTerms?.includes("2026届普通高校应届生"),
  );
  assert.ok(campusRecruitment.requiredAnswerTerms?.includes("企业年金"));
  assert.ok(campusRecruitment.requiredAnswerTerms?.includes("体检"));

  const negatives = suite.cases.filter(
    (item) => item.expectedErrorCode === "NO_GROUNDED_EVIDENCE",
  );
  assert.ok(negatives.length >= 1);
  for (const negative of negatives) {
    assert.equal(negative.expectedStatus, 422);
    assert.equal(negative.expectedAvailable, false);
    assert.ok((negative.target?.companies?.length ?? 0) >= 1);
  }

  const recoveredEvidence = suite.cases.find(
    (item) =>
      item.id === "china-great-wall-doctor-recruitment-recovered-evidence",
  );
  assert.ok(recoveredEvidence);
  assert.deepEqual(recoveredEvidence.target?.companies, ["中国长城"]);
  assert.equal(recoveredEvidence.expectedStatus, 200);
  assert.equal(recoveredEvidence.expectedAvailable, true);
  assert.ok(
    recoveredEvidence.requiredCitationUrlIncludes?.includes(
      "/c35432080/content.html",
    ),
  );
  assert.ok(recoveredEvidence.requiredAnswerTerms?.includes("六险二金"));
  assert.ok(
    recoveredEvidence.requiredAnswerTerms?.includes(
      "2026年7月31日17:00",
    ),
  );

  const stateGrid = suite.cases.find(
    (item) => item.id === "sgcc-2026-third-batch-unit-choice-and-exam",
  );
  assert.ok(stateGrid);
  assert.deepEqual(stateGrid.target?.companies, ["国家电网"]);
  assert.ok(stateGrid.requiredAnswerTerms?.includes("不超过3个"));
  assert.ok(stateGrid.requiredAnswerTerms?.includes("2026年5月17日"));

  const cnpc = suite.cases.find(
    (item) => item.id === "cnpc-2026-spring-age-language-and-unit-limit",
  );
  assert.ok(cnpc);
  assert.deepEqual(cnpc.target?.companies, ["中国石油"]);
  assert.ok(cnpc.requiredAnswerTerms?.includes("425分"));
  assert.ok(cnpc.requiredAnswerTerms?.includes("最多可应聘2家招聘单位"));
  assert.ok(cnpc.forbiddenAnswerTerms?.includes("job.sinopec.com"));

  const sinopec = suite.cases.find(
    (item) => item.id === "sinopec-2026-campus-major-portal-and-expiry",
  );
  assert.ok(sinopec);
  assert.deepEqual(sinopec.target?.companies, ["中国石化"]);
  assert.deepEqual(sinopec.allowedCitationHosts, ["www.sinopecgroup.com"]);
  assert.ok(sinopec.requiredAnswerTerms?.includes("job.sinopec.com"));
  assert.ok(sinopec.forbiddenAnswerTerms?.includes("zhaopin.cnpc.com.cn"));

  const chinaMobile = suite.cases.find(
    (item) =>
      item.id === "china-mobile-2026-spring-audience-roles-exam-and-portal",
  );
  assert.ok(chinaMobile);
  assert.deepEqual(chinaMobile.target?.companies, ["中国移动"]);
  assert.ok(chinaMobile.requiredAnswerTerms?.includes("4月18日"));
  assert.ok(
    chinaMobile.requiredAnswerTerms?.includes("https://job.10086.cn"),
  );

  const crrc = suite.cases.find(
    (item) =>
      item.id === "crrc-changchun-2026-location-major-benefits-and-process",
  );
  assert.ok(crrc);
  assert.deepEqual(crrc.allowedCitationHosts, ["www.crrcgc.cc"]);
  assert.ok(crrc.requiredAnswerTerms?.includes("七险两金"));
  assert.ok(
    crrc.requiredAnswerTerms?.includes("https://crrc-ckgf.hotjob.cn"),
  );

  const ceec = suite.cases.find(
    (item) =>
      item.id === "ceec-investment-2026-degree-language-age-and-process",
  );
  assert.ok(ceec);
  assert.deepEqual(ceec.target?.companies, ["中国能建投资集团"]);
  assert.ok(ceec.requiredAnswerTerms?.includes("国家英语六级及以上水平"));
  assert.ok(ceec.requiredAnswerTerms?.includes("博士年龄32岁及以下"));
});
