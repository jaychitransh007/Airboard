import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getConnectorRoutePoints,
  getRouteMidpoint,
} from "../dist/drawing-engine/src/connectorGeometry.js";

test("route offsets separate reciprocal connector bodies and label anchors", () => {
  const forward = {
    type: "connector",
    source: "voice",
    start: { x: 100, y: 100 },
    end: { x: 300, y: 100 },
  };
  const reverse = {
    type: "connector",
    source: "voice",
    start: { x: 300, y: 100 },
    end: { x: 100, y: 100 },
    routeOffset: 72,
  };

  const forwardRoute = getConnectorRoutePoints(forward);
  const reverseRoute = getConnectorRoutePoints(reverse);
  assert.deepEqual(forwardRoute, [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
  ]);
  assert.deepEqual(reverseRoute, [
    { x: 300, y: 100 },
    { x: 300, y: 28 },
    { x: 100, y: 28 },
    { x: 100, y: 100 },
  ]);
  assert.notDeepEqual(
    getRouteMidpoint(forwardRoute),
    getRouteMidpoint(reverseRoute),
  );
});
