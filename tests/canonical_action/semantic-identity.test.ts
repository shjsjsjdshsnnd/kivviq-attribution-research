import { expect, it } from "vitest";
import {
  createCanonicalFixtures,
  canonicalActionSchema,
  fingerprintCanonicalAction,
} from "../../src/canonical_action/index.js";
import {
  createPopulationFixtures,
  fingerprintPopulationDefinition,
} from "../../src/population/index.js";
it("distinguishes orders >=2 from >2 and CAD500 lifetime from trailing365", () => {
  const base = createPopulationFixtures()[0]!.definition;
  const fp = (inclusion: unknown) =>
    fingerprintPopulationDefinition({ ...base, inclusion });
  expect(
    fp({ kind: "COMPLETED_ORDER_COUNT", operator: "GTE", value: 2 }),
  ).not.toBe(fp({ kind: "COMPLETED_ORDER_COUNT", operator: "GT", value: 2 }));
  const money = {
    kind: "NET_REVENUE",
    operator: "GTE",
    amount: 500,
    currency: "CAD",
  };
  expect(fp({ ...money, window: { kind: "LIFETIME" } })).not.toBe(
    fp({ ...money, window: { kind: "TRAILING_DAYS", days: 365 } }),
  );
});
it("distinguishes seven days after placed vs delivered and recurring Tuesday vs one Tuesday", () => {
  const fixtures = createCanonicalFixtures();
  const event = fixtures[23]!.action!;
  const eventFp = (eventId: string) =>
    fingerprintCanonicalAction(
      canonicalActionSchema.parse({
        ...event,
        timing: {
          ...event.timing,
          requestedStart: {
            state: "SPECIFIED",
            value: {
              kind: "EVENT_RELATIVE",
              relation: "AFTER_EVENT",
              eventId,
              offset: { kind: "CALENDAR", amount: 7, unit: "DAY" },
            },
          },
        },
      }),
    );
  expect(eventFp("ORDER_PLACED")).not.toBe(eventFp("ORDER_DELIVERED"));
  const weekly = fixtures[26]!.action!;
  const single = canonicalActionSchema.parse({
    ...weekly,
    timing: { ...weekly.timing, recurrence: { state: "ABSENT" } },
  });
  expect(fingerprintCanonicalAction(weekly)).not.toBe(
    fingerprintCanonicalAction(single),
  );
});
