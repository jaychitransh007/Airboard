import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createFrameUiThrottle } from "../src/features/board/frameUiThrottle.ts";

test("frame UI commits coalesce within the interval and flush the trailing value", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let clock = 0;
    const committed = [];
    const throttle = createFrameUiThrottle((value) => committed.push(value), {
      intervalMs: 100,
      now: () => clock,
    });
    throttle.push("frame-1");
    for (const [at, value] of [[16, "frame-2"], [33, "frame-3"], [50, "frame-4"]]) {
      clock = at;
      throttle.push(value);
    }
    assert.deepEqual(committed, ["frame-1"]);
    clock = 100;
    mock.timers.tick(100);
    assert.deepEqual(committed, ["frame-1", "frame-4"]);
  } finally {
    mock.timers.reset();
  }
});

test("urgent frame UI changes commit immediately and cancel drops pending frames", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let clock = 0;
    const committed = [];
    const throttle = createFrameUiThrottle((value) => committed.push(value), {
      intervalMs: 100,
      now: () => clock,
    });
    throttle.push("idle");
    clock = 10;
    throttle.push("grabbed", true);
    clock = 20;
    throttle.push("moving");
    throttle.cancel();
    mock.timers.tick(200);
    assert.deepEqual(committed, ["idle", "grabbed"]);
  } finally {
    mock.timers.reset();
  }
});
