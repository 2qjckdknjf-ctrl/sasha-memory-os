export type FrozenRetrievalEvalCase = {
  id: string;
  query: string;
  actor: string;
  must_allow: boolean;
  expect_memory_title_includes?: string;
  expect_content_includes?: string;
  expect_empty_or_no_restricted?: boolean;
  expect_no_sensitivity?: string;
};

export type FrozenRetrievalEvalHit = {
  title: string;
  content: string;
  sensitivity: string;
};

export type FrozenRetrievalEvalReport = {
  evaluatedCaseCount: number;
  relevantCaseCount: number;
  relevantFoundAtK: number;
  recallAtK: number;
  topK: number;
  aclLeakageCases: number;
  failedCaseIds: string[];
};

function includesCaseExpectation(
  testCase: FrozenRetrievalEvalCase,
  hit: FrozenRetrievalEvalHit,
): boolean {
  const titleExpected = testCase.expect_memory_title_includes;
  if (titleExpected && hit.title.includes(titleExpected)) {
    return true;
  }
  const contentExpected = testCase.expect_content_includes;
  return Boolean(
    contentExpected &&
      hit.content.toLowerCase().includes(contentExpected.toLowerCase()),
  );
}

/**
 * Evaluate the frozen retrieval corpus without coupling the metric to one
 * storage backend. The caller must apply ACL before returning hits.
 */
export async function evaluateFrozenRetrievalQuality(input: {
  cases: readonly FrozenRetrievalEvalCase[];
  search: (testCase: FrozenRetrievalEvalCase) => Promise<FrozenRetrievalEvalHit[]>;
  topK?: number;
}): Promise<FrozenRetrievalEvalReport> {
  const topK = input.topK ?? 10;
  if (!Number.isInteger(topK) || topK <= 0) {
    throw new Error('topK must be a positive integer');
  }

  let relevantCaseCount = 0;
  let relevantFoundAtK = 0;
  let aclLeakageCases = 0;
  const failedCaseIds: string[] = [];

  for (const testCase of input.cases) {
    const hits = (await input.search(testCase)).slice(0, topK);
    const hasRelevantExpectation = Boolean(
      testCase.expect_memory_title_includes || testCase.expect_content_includes,
    );
    let failed = false;

    if (hasRelevantExpectation) {
      relevantCaseCount += 1;
      if (hits.some((hit) => includesCaseExpectation(testCase, hit))) {
        relevantFoundAtK += 1;
      } else {
        failed = true;
      }
    }

    const leaked =
      (!testCase.must_allow && hits.length > 0) ||
      (testCase.expect_empty_or_no_restricted === true &&
        hits.some((hit) => hit.sensitivity === 'restricted')) ||
      (typeof testCase.expect_no_sensitivity === 'string' &&
        hits.some((hit) => hit.sensitivity === testCase.expect_no_sensitivity));

    if (leaked) {
      aclLeakageCases += 1;
      failed = true;
    }
    if (failed) failedCaseIds.push(testCase.id);
  }

  return {
    evaluatedCaseCount: input.cases.length,
    relevantCaseCount,
    relevantFoundAtK,
    recallAtK:
      relevantCaseCount === 0
        ? 0
        : Number((relevantFoundAtK / relevantCaseCount).toFixed(6)),
    topK,
    aclLeakageCases,
    failedCaseIds,
  };
}
