import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDoctorName, GEO_VALIDATOR_NAME } from "../src/lib/utils";

test("formatDoctorName never turns the geofence sentinel into a doctor", () => {
  assert.equal(formatDoctorName(GEO_VALIDATOR_NAME), null);
  assert.equal(formatDoctorName(null), null);
  assert.equal(formatDoctorName("Dra. Maria Souza Lima"), "Dra Maria Souza");
  assert.equal(formatDoctorName("João Pedro"), "Dr João Pedro");
});
